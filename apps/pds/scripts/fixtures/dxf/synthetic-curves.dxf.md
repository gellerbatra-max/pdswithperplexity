# `synthetic-curves.*.dxf` — hand-written, not from any CAD system

Every other fixture in this directory is a real production export. These are
not, and the difference matters enough to say in a file of its own.

## Why they exist

Before curve support was written, all 125 DXF files on the development machine
were scanned — every apparel export on hand, from three CAD vendors. Between
them they contain:

- **0** `ARC` entities
- **0** `SPLINE` entities
- **0** non-zero bulges on a pattern polyline

Apparel CAD pre-flattens. It ships densely-sampled straight lines and leaves
the receiving system to re-fit curves if it wants them. That is a real finding
about the domain, and it is why the curve path could not be built the way
every other capability here was — against a file that proves what the format
actually looks like in practice.

## What that means for these fixtures

They are written against the DXF specification: bulge is `tan(θ/4)` on the
start vertex, `ARC` is centre/radius/start-angle/end-angle sweeping
counter-clockwise, `SPLINE` is a NURBS with degree, knots and control points.
Each one exercises exactly one mechanism so a failure names itself.

They prove the conversions are *correct against the spec*. They cannot prove
the conversions are *right for a real vendor's file*, because no such file was
available to check against. When one turns up, run `npm run report:dxf` on it
first: it is a test of this code, not routine input.

The expected values in `check-curves.ts` are derived from the geometric
definitions independently of `curves.ts` — a bulge arc's sagitta from
`|bulge| × chord/2`, an arc's length from `r·θ` — so a shared misreading of the
spec by the code and its test still fails.
