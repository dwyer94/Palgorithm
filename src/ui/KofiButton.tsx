/** Ko-fi support link (Phase 2, docs/PRODUCTION_READINESS_PLAN.md).
 *
 * Two earlier attempts didn't hold up:
 * - Ko-fi's official JS widget (`Widget_2.js`, `kofiwidget2.init/draw()`) calls
 *   `document.write()` internally, which wipes the whole document once triggered after the
 *   initial page parse — true for any script mounted by React, not a mounting-order bug on
 *   our end.
 * - Ko-fi's static badge PNG (`storage.ko-fi.com/cdn/kofi6.png`) is crisp at its native
 *   580×146, but rendering it at button size (~143×36) is a non-integer ~4x downscale that
 *   visibly softens the baked-in "Buy me a coffee" text.
 *
 * This inlines Ko-fi's own cup-logo mark as SVG (fetched from their brand CDN,
 * `storage.ko-fi.com/cdn/whitelogo.svg` — a real vector, not a rasterized icon) next to real
 * HTML text, styled as a pill in the same orange (`#FF6433`, sampled from their official
 * button asset) as the original badge. Same visual result — their logo, their color, pill
 * shape — but every part of it (icon path, text, background) is vector/real-DOM, so it stays
 * sharp at any zoom or display density instead of being a fixed-resolution raster image. */
function KofiCupIcon() {
  return (
    <svg viewBox="0 0 56.7 56.7" width={16} height={16} fill="currentColor" aria-hidden="true">
      <path d="m 23.959,10.600001 c -9.6,0 -17.4,7.8 -17.4,17.4 0,9.6 7.8,17.4 17.4,17.4 9.6,0 17.4,-7.8 17.4,-17.4 0,-9.6 -7.8,-17.4 -17.4,-17.4 z m 0.3,27.2 -0.5,0.2 -0.4,-0.2 c -0.4,-0.2 -9.8,-5.4 -9.8,-11.3 0,-3.8 2.5,-6.8 5.8,-6.8 1.6,0 3.1,0.7 4.5,2.1 1.3,-1.4 2.9,-2.1 4.5,-2.1 3.2,0 5.8,3 5.8,6.9 -0.1,5.8 -9.5,11 -9.9,11.2 z" />
      <path d="m 56.759293,28.5 c 0,-2.6 -2,-3 -3.4,-3.1 l -5.5,0 c -0.8,-8.4 -6,-15.7 -14.5,-19.4 -10.7,-4.6 -23.3,-0.7 -29.6,9.1 -7.6999993,12.1 -3.09999997,27.9 9.5,34.2 10.3,5.1 23.1,2 29.9,-7.3 2.5,-3.4 3.8,-6.9 4.3,-10.7 l 6.3,0 c 1.5,0 3,-0.5 3,-2.8 z m -40.8,17.7 c -11.3,-5 -15.39999897,-18.8 -8.7,-29.1 5.2,-8.2 15.8,-11.3 24.7,-7.4 11.3,5 15.4,18.8 8.7,29.1 -5.3,8.1 -15.9,11.3 -24.7,7.4 z" />
    </svg>
  );
}

export default function KofiButton() {
  return (
    <a
      href="https://ko-fi.com/W7W71K4KDW"
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg bg-[#FF6433] px-3.5 py-2 font-sans text-[13px] font-bold text-white hover:brightness-95"
    >
      <KofiCupIcon />
      Buy me a coffee
    </a>
  );
}
