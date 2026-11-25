# Rehearsal OMR Benchmark (`tools/omr-bench`)

Zero-dependency Python 3.9+ grader and issue-identification harness for Scan & Fix.

## Usage

```bash
# Grade repo OMR fixtures against baseline.json (including jsc post-processing)
/usr/bin/python3 tools/omr-bench/grade.py

# Grade raw OMR without jsc post-processing
/usr/bin/python3 tools/omr-bench/grade.py --no-postprocess

# Capture a verified local Scan & Fix job outside git into ~/Rehearsal-Backups/omr-bench/
/usr/bin/python3 tools/omr-bench/grade.py --capture-job <jobId> --slug my-choir-piece

# Grade private local benchmarks and write a Markdown report
/usr/bin/python3 tools/omr-bench/grade.py --dir ~/Rehearsal-Backups/omr-bench --report /tmp/omr-report.md

# Approve and update baseline.json after reviewing an improvement
/usr/bin/python3 tools/omr-bench/grade.py --update-baseline
```

## Regression Gate

- Drift `>= 1.0` point prints a warning.
- Regression `> 2.0` points on `overall` (or any core dimension with `--strict`) exits non-zero.
