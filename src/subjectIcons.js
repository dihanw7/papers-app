// Built-in subject icons (flat illustrations in circular frames). A subject gets
// one automatically when its name matches; admins can upload their own SVG
// instead, stored in subjects.icon_svg. Icons are drawn with <img> tags, so an
// uploaded file can't run scripts on the page.

const SKIN = '#f6c9a4';
const SKIN_SHADE = '#e9ae86';

function frame(tint, ring, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
    + '<defs><clipPath id="c"><circle cx="48" cy="48" r="44"/></clipPath></defs>'
    + '<circle cx="48" cy="48" r="44" fill="' + tint + '"/>'
    + '<g clip-path="url(#c)">' + body + '</g>'
    + '<circle cx="48" cy="48" r="44" fill="none" stroke="' + ring + '" stroke-width="2.5"/>'
    + '</svg>';
}

const PAEDIATRICS = frame('#fdebd8', '#f2a54a',
  // floor
  '<rect x="0" y="74" width="96" height="30" fill="#f9dcc0"/>'
  // ball + block
  + '<circle cx="21" cy="70" r="8" fill="#f2a54a"/><path d="M14 68a8 8 0 0 1 14-3" stroke="#e08a2c" stroke-width="1.5" fill="none"/>'
  + '<rect x="31" y="67" width="8" height="8" rx="1.5" fill="#f5b25e"/>'
  // stacking rings
  + '<rect x="72.5" y="50" width="3" height="12" rx="1.5" fill="#8a4b2a"/>'
  + '<ellipse cx="74" cy="72" rx="10" ry="4" fill="#8a4b2a"/><ellipse cx="74" cy="66.5" rx="8" ry="3.5" fill="#a65d35"/><ellipse cx="74" cy="61.5" rx="6" ry="3" fill="#8a4b2a"/><ellipse cx="74" cy="57" rx="4" ry="2.5" fill="#a65d35"/>'
  // body + legs
  + '<path d="M36 70c0-14 5-24 12-24s12 10 12 24z" fill="' + SKIN + '"/>'
  + '<path d="M34 68c4-4 24-4 28 0l-2 7H36z" fill="#ffffff"/>'
  + '<ellipse cx="38" cy="74" rx="9" ry="4.5" fill="' + SKIN + '"/><ellipse cx="58" cy="74" rx="9" ry="4.5" fill="' + SKIN + '"/>'
  // arms holding a block
  + '<path d="M40 54c-4 4-6 8-5 11" stroke="' + SKIN_SHADE + '" stroke-width="5" stroke-linecap="round" fill="none"/>'
  + '<path d="M56 54c4 2 7 4 9 3" stroke="' + SKIN_SHADE + '" stroke-width="5" stroke-linecap="round" fill="none"/>'
  + '<rect x="63" y="51" width="7" height="7" rx="1.5" fill="#b8753f"/>'
  // head
  + '<circle cx="48" cy="36" r="12" fill="' + SKIN + '"/>'
  + '<path d="M36 35c0-9 6-13 12-13s12 4 12 11c-3-4-7-5-9-3-3-3-8-3-11 0-2 1-3 3-4 5z" fill="#8a4b2a"/>'
  + '<circle cx="43.5" cy="38" r="1.3" fill="#8a4b2a"/><circle cx="52.5" cy="38" r="1.3" fill="#8a4b2a"/>');

const SURGERY = frame('#e3f1e3', '#6db37a',
  // theatre lamp
  '<path d="M58 4l10 14" stroke="#9dcba5" stroke-width="3"/>'
  + '<ellipse cx="72" cy="22" rx="13" ry="8" transform="rotate(25 72 22)" fill="#e8f5e9" stroke="#6db37a" stroke-width="2"/>'
  + '<circle cx="66" cy="19" r="2" fill="#ffffff" stroke="#6db37a"/><circle cx="72" cy="22" r="2.6" fill="#6db37a"/><circle cx="78" cy="25" r="2" fill="#ffffff" stroke="#6db37a"/><circle cx="71" cy="15" r="2" fill="#ffffff" stroke="#6db37a"/><circle cx="74" cy="29" r="2" fill="#ffffff" stroke="#6db37a"/>'
  // gown
  + '<path d="M16 96c0-20 10-32 26-32s26 12 26 32z" fill="#6db37a"/>'
  // neck + head
  + '<rect x="37" y="50" width="10" height="10" fill="' + SKIN_SHADE + '"/>'
  + '<circle cx="42" cy="42" r="12" fill="' + SKIN + '"/>'
  // cap + mask
  + '<path d="M29 40c0-10 6-15 13-15s13 5 13 13c-8-2-18-2-26 2z" fill="#5aa468"/>'
  + '<path d="M33 44h19c0 7-4 11-9.5 11S33 51 33 44z" fill="#8fcf9a"/>'
  + '<path d="M32 44l-3-2M53 44l3-2" stroke="#8fcf9a" stroke-width="1.5"/>'
  // patient drape + gloved hands with instruments
  + '<path d="M0 84c20-8 50-10 96-4v20H0z" fill="#8cc596"/>'
  + '<path d="M60 70l14-12" stroke="#4d8b58" stroke-width="2" stroke-linecap="round"/>'
  + '<ellipse cx="60" cy="72" rx="6" ry="4.5" fill="#ffffff"/>'
  + '<path d="M26 72l10-6" stroke="#4d8b58" stroke-width="2" stroke-linecap="round"/>'
  + '<ellipse cx="26" cy="74" rx="6" ry="4.5" fill="#ffffff"/>');

const MEDICINE = frame('#dde9f6', '#4f86c6',
  // desk
  '<rect x="0" y="76" width="96" height="24" fill="#b9d0ea"/>'
  // white coat + shirt
  + '<path d="M20 96c0-22 12-34 28-34s28 12 28 34z" fill="#ffffff"/>'
  + '<path d="M42 62h12l-6 16z" fill="#bcd6f2"/>'
  // stethoscope
  + '<path d="M38 64c-4 8-4 16 0 20M58 64c4 6 4 10 2 14" stroke="#2f5e8f" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
  + '<circle cx="39" cy="86" r="3.5" fill="#ffffff" stroke="#2f5e8f" stroke-width="2"/>'
  // neck + head + hair
  + '<rect x="43" y="52" width="10" height="10" fill="' + SKIN_SHADE + '"/>'
  + '<circle cx="48" cy="42" r="12" fill="' + SKIN + '"/>'
  + '<path d="M35 42c-2-12 6-18 14-18 8 0 14 5 12 14-4-5-10-7-16-6-4 1-8 5-10 10z" fill="#264a73"/>'
  // clipboard
  + '<g transform="rotate(12 70 72)"><rect x="61" y="60" width="18" height="24" rx="2" fill="#2f5e8f"/><rect x="66" y="57" width="8" height="5" rx="1.5" fill="#1f4166"/><path d="M65 68h10M65 72h10M65 76h7" stroke="#8fb3dc" stroke-width="1.5"/></g>'
  // medicine bottle + pills
  + '<rect x="12" y="66" width="14" height="18" rx="2.5" fill="#4f86c6"/><rect x="13" y="62" width="12" height="5" rx="1.5" fill="#2f5e8f"/><path d="M19 71v8M15 75h8" stroke="#ffffff" stroke-width="2.5"/>'
  + '<ellipse cx="31" cy="82" rx="3.5" ry="2" fill="#2f5e8f"/><ellipse cx="36" cy="83" rx="3" ry="1.8" fill="#ffffff"/>');

const GYN_OBS = frame('#fbe3ec', '#e57ba2',
  // hair (back)
  '<path d="M28 34c0-12 8-18 16-18s14 6 14 14c0 6-2 8-4 10l-2 26c-6 2-14 0-20-4 2-8-4-14-4-28z" fill="#a8546e"/>'
  // dress with bump
  + '<path d="M26 96c0-10 2-22 8-30 4-4 14-4 18 0 10 2 18 10 18 20 0 5-3 8-6 10z" fill="#e57ba2"/>'
  // bump
  + '<circle cx="54" cy="78" r="14" fill="#e57ba2"/><path d="M46 70a14 14 0 0 1 16 0" stroke="#f29bbb" stroke-width="2" fill="none"/>'
  // arm cradling the bump
  + '<path d="M38 64c0 10 4 20 16 25" stroke="' + SKIN_SHADE + '" stroke-width="5" stroke-linecap="round" fill="none"/>'
  // neck + face (profile, looking down-right)
  + '<rect x="40" y="46" width="8" height="12" fill="' + SKIN_SHADE + '"/>'
  + '<path d="M36 36c0-7 5-12 11-12s10 5 10 11c0 2 1 3 3 6l-3 1c0 4-2 7-6 7h-5c-6-1-10-6-10-13z" fill="' + SKIN + '"/>'
  + '<path d="M34 34c0-8 6-14 13-14 6 0 9 3 10 7-6-2-12 0-16 4-2 3-3 7-3 12l-3 1z" fill="#a8546e"/>'
  // heart with baby
  + '<path d="M76 40c-4-6-13-3-11 4 1 5 11 12 11 12s10-7 11-12c2-7-7-10-11-4z" fill="#ffffff" stroke="#e57ba2" stroke-width="1.8"/>'
  + '<circle cx="74" cy="44" r="3" fill="none" stroke="#e57ba2" stroke-width="1.5"/><path d="M76 46c2 2 3 5 1 7-2 1-5 0-5-3" fill="none" stroke="#e57ba2" stroke-width="1.5"/>');

const PSYCHIATRY = frame('#ece4f5', '#8b63b8',
  // shoulders
  '<path d="M22 96c0-18 10-28 26-28s26 10 26 28z" fill="#8b63b8"/>'
  // neck
  + '<rect x="36" y="54" width="12" height="16" fill="#c2a9de"/>'
  // head profile facing left
  + '<path d="M58 42c0-12-8-20-18-20-9 0-15 6-15 14 0 3-3 5-4 8l3 1c0 4 1 7 4 8l1 5c3 2 7 2 11 1 10-2 18-7 18-17z" fill="#c2a9de"/>'
  + '<path d="M26 34c0-10 7-16 16-16 10 0 18 7 18 18 0 6-2 10-6 13 1-6 0-12-4-14-6 2-14 0-18-5-2 1-4 3-6 4z" fill="#7a55a6"/>'
  // brain
  + '<g transform="translate(58 14)" fill="#ffffff" stroke="#8b63b8" stroke-width="1.6" stroke-linejoin="round">'
  + '<path d="M6 16c-4 0-6-3-5-6 0-3 3-5 5-5 1-3 4-5 7-4 2-2 6-2 8 0 3-1 6 1 7 4 3 1 4 4 3 7 1 3-1 6-4 6-1 2-4 3-6 2-2 2-5 2-7 0-2 1-5 1-6-1-1 0-2-1-2-3z"/>'
  + '<path d="M13 5c-1 3 0 6 3 7M21 5c0 3-2 5-4 6M9 11c2 1 4 3 4 5M24 11c-2 1-3 3-3 5M16 12v6" fill="none"/>'
  + '<path d="M18 21c1 3 1 5-1 7" fill="none"/></g>');

// Order matters: the first entry whose pattern matches the subject name wins.
export const BUILTIN_ICONS = [
  { key: 'paediatrics', label: 'Paediatrics', match: /paed|pedia|child/i, svg: PAEDIATRICS },
  { key: 'gyn-obs', label: 'Gyn & Obs', match: /gyn|obs|obst|matern|women/i, svg: GYN_OBS },
  { key: 'psychiatry', label: 'Psychiatry', match: /psych|mental/i, svg: PSYCHIATRY },
  { key: 'surgery', label: 'Surgery', match: /surg/i, svg: SURGERY },
  { key: 'medicine', label: 'Medicine', match: /medic/i, svg: MEDICINE },
];

function svgToImgSrc(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// The SVG to show for a subject: its uploaded icon, else a built-in one that
// matches its name, else null (the caller falls back to a letter swatch).
export function subjectIconSrc(subject) {
  if (subject.iconSvg) return svgToImgSrc(subject.iconSvg);
  const hit = BUILTIN_ICONS.find((i) => i.match.test(subject.name || ''));
  return hit ? svgToImgSrc(hit.svg) : null;
}

// Checks an uploaded file is a reasonable SVG before it's saved.
export function validateSvgUpload(text) {
  if (text.length > 200000) return 'That SVG is too large (over 200 KB). Try simplifying or optimising it.';
  if (!/<svg[\s>]/i.test(text)) return 'That file doesn\'t look like an SVG image.';
  return null;
}
