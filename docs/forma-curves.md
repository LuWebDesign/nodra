# Forma curves: current model boundary

Forma currently edits polygon vertices and the existing primitive geometry. A contour stores each ring as a closed list of points; it has no segment discriminant or control points. Consequently, the editor must not present a curve conversion that would imply Bézier behavior or silently curve an entire object.

A safe future extension should replace each ring's point-only representation with typed segment records (for example, line segments and cubic segments), while preserving segment identity and validating endpoint continuity. The conversion command must address one ring and one segment, and all geometry, hit-testing, SVG rendering, insertion, deletion, and migration code must understand the new records before the operation is exposed.

For this revision, primitive conversion and polygon node editing remain explicit and correct; no curve metadata or fake Bézier approximation is persisted.
