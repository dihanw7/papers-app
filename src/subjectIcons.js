// Built-in subject icons: the five round illustrations, stored as images in
// src/assets/subject-icons. A subject gets one automatically when its name
// matches; admins can upload their own icon instead (SVG or a picture), stored
// in subjects.icon_svg. Icons are drawn with <img> tags, so an uploaded SVG
// can't run scripts on the page.
import paediatrics from './assets/subject-icons/paediatrics.webp';
import surgery from './assets/subject-icons/surgery.webp';
import medicine from './assets/subject-icons/medicine.webp';
import gynObs from './assets/subject-icons/gyn-obs.webp';
import psychiatry from './assets/subject-icons/psychiatry.webp';

// Order matters: the first entry whose pattern matches the subject name wins.
export const BUILTIN_ICONS = [
  { key: 'paediatrics', label: 'Paediatrics', match: /paed|pedia|child/i, src: paediatrics },
  { key: 'gyn-obs', label: 'Gyn & Obs', match: /gyn|obs|obst|matern|women/i, src: gynObs },
  { key: 'psychiatry', label: 'Psychiatry', match: /psych|mental/i, src: psychiatry },
  { key: 'surgery', label: 'Surgery', match: /surg/i, src: surgery },
  { key: 'medicine', label: 'Medicine', match: /medic/i, src: medicine },
];

// An uploaded icon is stored either as SVG markup or as a picture data URL.
function uploadedIconSrc(value) {
  return value.startsWith('data:image/') ? value : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value);
}

// The image to show for a subject: its uploaded icon, else a built-in one that
// matches its name, else null (the caller falls back to a letter swatch).
export function subjectIconSrc(subject) {
  if (subject.iconSvg) return uploadedIconSrc(subject.iconSvg);
  const hit = BUILTIN_ICONS.find((i) => i.match.test(subject.name || ''));
  return hit ? hit.src : null;
}

export const ICON_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp';

// Turns a chosen file into what's stored in subjects.icon_svg: SVG files as
// their markup, pictures shrunk to 256px and stored as a WebP data URL.
// Resolves to { value } or { error }.
export function readIconFile(file) {
  return new Promise((resolve) => {
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    const reader = new FileReader();
    reader.onerror = () => resolve({ error: 'Could not read that file.' });
    if (isSvg) {
      reader.onload = () => {
        const text = String(reader.result || '');
        if (text.length > 200000) return resolve({ error: 'That SVG is too large (over 200 KB). Try simplifying or optimising it.' });
        if (!/<svg[\s>]/i.test(text)) return resolve({ error: 'That file doesn\'t look like an SVG image.' });
        resolve({ value: text });
      };
      reader.readAsText(file);
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return resolve({ error: 'Choose an SVG, PNG, JPG or WebP image.' });
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve({ error: 'That image could not be opened.' });
      img.onload = () => {
        // Fit inside a 256px square, keeping the shape and any transparency.
        const size = 256;
        const scale = Math.min(size / img.width, size / img.height, 1);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve({ value: canvas.toDataURL('image/webp', 0.9) });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
