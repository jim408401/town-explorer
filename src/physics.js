/**
 * Moves a circle of radius `r` from (x, z) by (dx, dz), sliding along colliders and
 * staying on walkable ground. Returns the new { x, z }.
 */
export function moveWithCollisions(x, z, dx, dz, r, colliders, isWalkable) {
  // Try the full move first, then each axis on its own so we slide along the coast
  let nx = x + dx;
  let nz = z + dz;
  if (!isWalkable(nx, nz)) {
    if (isWalkable(x + dx, z)) nz = z;
    else if (isWalkable(x, z + dz)) nx = x;
    else return { x, z };
  }

  // Push out of any overlapping colliders (two passes settle corners)
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      if (c.type === 'circle') {
        const ox = nx - c.x;
        const oz = nz - c.z;
        const min = c.r + r;
        const d2 = ox * ox + oz * oz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          nx = c.x + (ox / d) * min;
          nz = c.z + (oz / d) * min;
        }
      } else {
        const cx = Math.max(c.minX, Math.min(nx, c.maxX));
        const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
        const ox = nx - cx;
        const oz = nz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 < r * r) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = cx + (ox / d) * r;
            nz = cz + (oz / d) * r;
          } else {
            // Centre is inside the box: push out through the nearest side
            const pushes = [
              [c.minX - r - nx, 0],
              [c.maxX + r - nx, 0],
              [0, c.minZ - r - nz],
              [0, c.maxZ + r - nz],
            ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
            nx += pushes[0][0];
            nz += pushes[0][1];
          }
        }
      }
    }
  }
  if (!isWalkable(nx, nz)) return { x, z };
  return { x: nx, z: nz };
}
