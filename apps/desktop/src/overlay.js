"use strict";
const box = document.getElementById("box");
let sx = 0, sy = 0, dragging = false;

function rectFrom(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
function draw(r) {
  box.style.display = "block";
  box.style.left = r.x + "px";
  box.style.top = r.y + "px";
  box.style.width = r.w + "px";
  box.style.height = r.h + "px";
}

window.addEventListener("mousedown", (e) => { dragging = true; sx = e.clientX; sy = e.clientY; draw({ x: sx, y: sy, w: 0, h: 0 }); });
window.addEventListener("mousemove", (e) => { if (dragging) draw(rectFrom(sx, sy, e.clientX, e.clientY)); });
window.addEventListener("mouseup", (e) => {
  if (!dragging) return;
  dragging = false;
  window.atlas.regionSelected(rectFrom(sx, sy, e.clientX, e.clientY));
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") window.atlas.regionCancelled(); });
