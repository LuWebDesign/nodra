# Explicit node connections

Nodra persists confirmed creation snaps as connections between stable element/node addresses. Hovering a node only displays inference feedback; it never changes the document.

Inspector width and height edits honor a connected side on the selected rectangle or ellipse. A left/top connection keeps that coordinate fixed, a right/bottom connection keeps the opposite coordinate fixed, and the other side moves. With no relevant connection, the existing centered resize behavior remains. Aspect lock applies the proportional dimension before applying the same anchor policy.

If both opposite sides for the edited axis are connected, the resize is rejected as an atomic no-op and the editor reports that the existing connections cannot be preserved. External objects are never moved by an inspector resize. Connections are stored in document/page snapshots, validated for live element and node addresses, and old snapshots migrate with an empty connection list.
