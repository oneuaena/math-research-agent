#!/usr/bin/env python3
"""Durable exact enumeration of the delete-2/add-3 neighbourhood of a fixed n=71 baseline.

This is a bundled, auditable batch driver rather than model-produced code.  It is
intentionally scoped: completing it says nothing about other 141-point
configurations or larger destroy neighbourhoods.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import os
import sys
from pathlib import Path

GRID = 71
POINT_COUNT = 140
DELETE_COUNT = 2
ADD_COUNT = 3


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def append_jsonl(path: Path, value: dict) -> None:
    with path.open('a', encoding='utf-8', newline='\n') as handle:
        handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + '\n')
        handle.flush()
        os.fsync(handle.fileno())


def parse_baseline(path: Path) -> list[tuple[int, int]]:
    points: list[tuple[int, int]] = []
    for raw in path.read_text(encoding='utf-8', errors='strict').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        fields = line.split()
        if len(fields) != 3:
            raise ValueError(f'Invalid baseline row: {raw!r}')
        row, first, second = (int(item) for item in fields)
        points.extend(((row, first), (row, second)))
    if len(points) != POINT_COUNT or len(set(points)) != POINT_COUNT:
        raise ValueError(f'Expected {POINT_COUNT} distinct baseline points, found {len(points)} / {len(set(points))}.')
    if any(row < 0 or row >= GRID or col < 0 or col >= GRID for row, col in points):
        raise ValueError('Baseline contains a coordinate outside the 71x71 grid.')
    return points


def collinear(first: tuple[int, int], second: tuple[int, int], third: tuple[int, int]) -> bool:
    return (second[0] - first[0]) * (third[1] - first[1]) == (second[1] - first[1]) * (third[0] - first[0])


def brute_triple_count(points: list[tuple[int, int]]) -> int:
    return sum(1 for first, second, third in itertools.combinations(points, 3) if collinear(first, second, third))


def validate_baseline(points: list[tuple[int, int]]) -> dict:
    rows = [0] * GRID
    cols = [0] * GRID
    for row, col in points:
        rows[row] += 1
        cols[col] += 1
    triples = brute_triple_count(points)
    if triples != 0:
        raise ValueError(f'Baseline has {triples} collinear triples; refuse to enumerate an invalid baseline.')
    if max(rows) > 2 or max(cols) > 2:
        raise ValueError('Baseline violates the necessary at-most-two row/column condition.')
    return {'points': len(points), 'triples': triples, 'row_counts': rows, 'col_counts': cols}


def grid_index(point: tuple[int, int]) -> int:
    return point[0] * GRID + point[1]


def line_grid_points(first: tuple[int, int], second: tuple[int, int]):
    dx = second[0] - first[0]
    dy = second[1] - first[1]
    divisor = math.gcd(abs(dx), abs(dy))
    step_row, step_col = dx // divisor, dy // divisor
    row, col = first
    while 0 <= row - step_row < GRID and 0 <= col - step_col < GRID:
        row -= step_row
        col -= step_col
    while 0 <= row < GRID and 0 <= col < GRID:
        yield (row, col)
        row += step_row
        col += step_col


def build_survivor_witnesses(points: list[tuple[int, int]]) -> tuple[list[list[int]], dict[tuple[int, int], int]]:
    witnesses: list[list[int]] = [[] for _ in range(GRID * GRID)]
    coordinate_index = {point: index for index, point in enumerate(points)}
    for first_index, second_index in itertools.combinations(range(len(points)), 2):
        pair_mask = (1 << first_index) | (1 << second_index)
        for point in line_grid_points(points[first_index], points[second_index]):
            witnesses[grid_index(point)].append(pair_mask)
    return witnesses, coordinate_index


def candidate_blocked_by_survivors(point: tuple[int, int], deleted_mask: int, witnesses: list[list[int]]) -> bool:
    return any((pair_mask & deleted_mask) == 0 for pair_mask in witnesses[grid_index(point)])


def survivor_mask_on_added_line(
    first: tuple[int, int],
    second: tuple[int, int],
    coordinate_index: dict[tuple[int, int], int],
    cache: dict[tuple[int, int], int],
) -> int:
    first_key, second_key = sorted((grid_index(first), grid_index(second)))
    key = (first_key, second_key)
    known = cache.get(key)
    if known is not None:
        return known
    mask = 0
    for point in line_grid_points(first, second):
        index = coordinate_index.get(point)
        if index is not None:
            mask |= 1 << index
    cache[key] = mask
    return mask


def respects_row_col_capacity(added: tuple[tuple[int, int], ...], row_counts: list[int], col_counts: list[int]) -> bool:
    rows = row_counts[:]
    cols = col_counts[:]
    for row, col in added:
        rows[row] += 1
        cols[col] += 1
        if rows[row] > 2 or cols[col] > 2:
            return False
    return True


def exact_candidate_is_valid(
    survivor: list[tuple[int, int]], added: tuple[tuple[int, int], ...], deleted_mask: int,
    witnesses: list[list[int]], coordinate_index: dict[tuple[int, int], int], pair_cache: dict[tuple[int, int], int],
) -> bool:
    if any(candidate_blocked_by_survivors(point, deleted_mask, witnesses) for point in added):
        return False
    for first, second in itertools.combinations(added, 2):
        if survivor_mask_on_added_line(first, second, coordinate_index, pair_cache) & ~deleted_mask:
            return False
    return not collinear(added[0], added[1], added[2])


def initial_checkpoint(baseline: Path, baseline_hash: str, script_hash: str, seed: int) -> dict:
    return {
        'schema_version': 1,
        'experiment': 'destroyed=2 exact enumeration: two-point deletion + three-point insertion',
        'scope': 'fixed 140-point baseline only; never a claim about global 141-point nonexistence',
        'status': 'RUNNING',
        'grid': GRID,
        'baseline_file': baseline.name,
        'baseline_sha256': baseline_hash,
        'script_sha256': script_hash,
        'parameters': {'delete_count': DELETE_COUNT, 'add_count': ADD_COUNT, 'seed': seed, 'enumeration': 'deterministic exact integer arithmetic'},
        'total_delete_pairs': POINT_COUNT * (POINT_COUNT - 1) // 2,
        'next_delete_pair_index': 0,
        'completed_delete_pairs': 0,
        'remaining_delete_pairs': POINT_COUNT * (POINT_COUNT - 1) // 2,
        'candidate_sets_checked': 0,
        'valid_141_candidates': [],
        'batches_completed': 0,
    }


def load_checkpoint(path: Path, baseline: Path, baseline_hash: str, script_hash: str, seed: int, reset: bool) -> dict:
    if reset or not path.exists():
        return initial_checkpoint(baseline, baseline_hash, script_hash, seed)
    checkpoint = json.loads(path.read_text(encoding='utf-8'))
    if checkpoint.get('baseline_sha256') != baseline_hash:
        raise ValueError('Checkpoint baseline hash differs from the requested baseline; refusing to mix runs.')
    if checkpoint.get('parameters', {}).get('seed') != seed:
        raise ValueError('Checkpoint seed differs from the requested seed; use the original seed or reset explicitly.')
    checkpoint['script_sha256'] = script_hash
    return checkpoint


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True, help='Relative or absolute baseline coordinate file.')
    parser.add_argument('--checkpoint', default='destroy2_141_checkpoint.json')
    parser.add_argument('--batch-log', default='destroy2_141_batches.jsonl')
    parser.add_argument('--max-pairs', type=int, default=25, help='Deletion pairs to process in this invocation.')
    parser.add_argument('--seed', type=int, default=71)
    parser.add_argument('--reset', action='store_true')
    parser.add_argument('--test-interrupt-after', type=int, default=0, help='Testing only: checkpoint then return 75 after this many pairs.')
    args = parser.parse_args()
    if args.max_pairs < 1:
        raise ValueError('--max-pairs must be positive.')

    baseline_path = Path(args.baseline).resolve()
    checkpoint_path = Path(args.checkpoint).resolve()
    batch_log_path = Path(args.batch_log).resolve()
    points = parse_baseline(baseline_path)
    baseline_validation = validate_baseline(points)
    baseline_hash = sha256_file(baseline_path)
    script_hash = sha256_file(Path(__file__).resolve())
    checkpoint = load_checkpoint(checkpoint_path, baseline_path, baseline_hash, script_hash, args.seed, args.reset)
    deletion_pairs = list(itertools.combinations(range(POINT_COUNT), DELETE_COUNT))
    if checkpoint['total_delete_pairs'] != len(deletion_pairs):
        raise ValueError('Checkpoint does not match the expected 9,730 deletion pairs.')

    witnesses, coordinate_index = build_survivor_witnesses(points)
    pair_cache: dict[tuple[int, int], int] = {}
    initial_rows = baseline_validation['row_counts']
    initial_cols = baseline_validation['col_counts']
    start = int(checkpoint['next_delete_pair_index'])
    end = min(len(deletion_pairs), start + args.max_pairs)
    candidates_before = int(checkpoint['candidate_sets_checked'])
    found_before = len(checkpoint['valid_141_candidates'])

    for pair_index in range(start, end):
        first_index, second_index = deletion_pairs[pair_index]
        deleted_mask = (1 << first_index) | (1 << second_index)
        deleted = {first_index, second_index}
        survivor = [point for index, point in enumerate(points) if index not in deleted]
        rows = initial_rows[:]
        cols = initial_cols[:]
        for index in deleted:
            row, col = points[index]
            rows[row] -= 1
            cols[col] -= 1
        open_rows = [row for row, count in enumerate(rows) if count < 2]
        open_cols = [col for col, count in enumerate(cols) if count < 2]
        survivor_set = set(survivor)
        addable = [(row, col) for row in open_rows for col in open_cols if (row, col) not in survivor_set]
        for added in itertools.combinations(addable, ADD_COUNT):
            if not respects_row_col_capacity(added, rows, cols):
                continue
            checkpoint['candidate_sets_checked'] += 1
            if exact_candidate_is_valid(survivor, added, deleted_mask, witnesses, coordinate_index, pair_cache):
                full_candidate = survivor + list(added)
                triples = brute_triple_count(full_candidate)
                if triples != 0:
                    raise AssertionError('Incremental verifier disagreed with full exact triple census.')
                checkpoint['valid_141_candidates'].append({'delete_indices': [first_index, second_index], 'added_points': [list(point) for point in added], 'triple_count': triples})
        checkpoint['next_delete_pair_index'] = pair_index + 1
        checkpoint['completed_delete_pairs'] = pair_index + 1
        checkpoint['remaining_delete_pairs'] = len(deletion_pairs) - (pair_index + 1)
        atomic_json(checkpoint_path, checkpoint)
        if args.test_interrupt_after and pair_index - start + 1 >= args.test_interrupt_after:
            checkpoint['status'] = 'INTERRUPTED_FOR_RESUME_TEST'
            atomic_json(checkpoint_path, checkpoint)
            append_jsonl(batch_log_path, {'status': checkpoint['status'], 'start': start, 'end_exclusive': pair_index + 1, 'checkpoint': checkpoint_path.name, 'completed_delete_pairs': checkpoint['completed_delete_pairs'], 'remaining_delete_pairs': checkpoint['remaining_delete_pairs'], 'candidate_sets_checked_this_batch': checkpoint['candidate_sets_checked'] - candidates_before})
            print(json.dumps({'status': checkpoint['status'], 'resume_from': checkpoint['next_delete_pair_index'], 'baseline_triples': baseline_validation['triples']}, sort_keys=True))
            return 75

    checkpoint['batches_completed'] += 1
    checkpoint['status'] = 'COMPLETE' if end == len(deletion_pairs) else 'RUNNING'
    if checkpoint['status'] == 'COMPLETE':
        checkpoint['conclusion_scope'] = 'The delete-2/add-3 neighbourhood of this fixed baseline was enumerated. This is not a global nonexistence statement.'
    atomic_json(checkpoint_path, checkpoint)
    summary = {'status': checkpoint['status'], 'start': start, 'end_exclusive': end, 'completed_delete_pairs': checkpoint['completed_delete_pairs'], 'remaining_delete_pairs': checkpoint['remaining_delete_pairs'], 'candidate_sets_checked_this_batch': checkpoint['candidate_sets_checked'] - candidates_before, 'valid_141_candidates_added': len(checkpoint['valid_141_candidates']) - found_before, 'baseline_sha256': baseline_hash, 'baseline_triples': baseline_validation['triples'], 'checkpoint': checkpoint_path.name, 'seed': args.seed}
    append_jsonl(batch_log_path, summary)
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status': 'FAILED', 'error': str(error)}, sort_keys=True), file=sys.stderr)
        raise
