#!/usr/bin/env python3
"""Exact delete-1/add-2 audit for the fixed n=71 140-point baseline.

This verifier does not assume that both inserted points are in the formerly empty
row.  It enumerates every row/column-capacity-respecting insertion, because a
141-point no-three-in-line candidate need only have at most two per row/column.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from n71_destroy2_batch import (
    ADD_COUNT,
    GRID,
    POINT_COUNT,
    atomic_json,
    build_survivor_witnesses,
    candidate_blocked_by_survivors,
    collinear,
    exact_candidate_is_valid,
    parse_baseline,
    respects_row_col_capacity,
    sha256_file,
    validate_baseline,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--output', default='destroy1_141_full_audit.json')
    args = parser.parse_args()
    baseline_path = Path(args.baseline).resolve()
    output_path = Path(args.output).resolve()
    points = parse_baseline(baseline_path)
    baseline = validate_baseline(points)
    witnesses, coordinate_index = build_survivor_witnesses(points)
    pair_cache: dict[tuple[int, int], int] = {}
    candidate_sets_checked = 0
    legal: list[dict] = []
    for deleted_index in range(POINT_COUNT):
        deleted_mask = 1 << deleted_index
        survivor = [point for index, point in enumerate(points) if index != deleted_index]
        rows, cols = baseline['row_counts'][:], baseline['col_counts'][:]
        row, col = points[deleted_index]
        rows[row] -= 1
        cols[col] -= 1
        survivor_set = set(survivor)
        open_rows = [value for value, count in enumerate(rows) if count < 2]
        open_cols = [value for value, count in enumerate(cols) if count < 2]
        addable = [(candidate_row, candidate_col) for candidate_row in open_rows for candidate_col in open_cols if (candidate_row, candidate_col) not in survivor_set]
        for added in itertools.combinations(addable, ADD_COUNT - 1):
            if not respects_row_col_capacity(added, rows, cols):
                continue
            candidate_sets_checked += 1
            if exact_candidate_is_valid(survivor, added, deleted_mask, witnesses, coordinate_index, pair_cache):
                legal.append({'delete_index': deleted_index, 'added_points': [list(point) for point in added]})
    evidence = {
        'schema_version': 1,
        'experiment': 'destroyed=1 exact enumeration: one-point deletion + two-point insertion',
        'scope': 'fixed 140-point baseline only; never a claim about global 141-point nonexistence',
        'baseline_file': baseline_path.name,
        'baseline_sha256': sha256_file(baseline_path),
        'script_sha256': sha256_file(Path(__file__).resolve()),
        'baseline_points': len(points),
        'baseline_collinear_triples': baseline['triples'],
        'deleted_points_enumerated': POINT_COUNT,
        'candidate_sets_checked': candidate_sets_checked,
        'legal_141_candidates': legal,
        'legal_141_candidate_count': len(legal),
        'criterion': 'exact integer determinant; every inserted set respecting at-most-two rows/columns is checked',
        'status': 'COMPLETE',
    }
    atomic_json(output_path, evidence)
    print(json.dumps({key: evidence[key] for key in ('status', 'baseline_collinear_triples', 'deleted_points_enumerated', 'candidate_sets_checked', 'legal_141_candidate_count', 'baseline_sha256')}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
