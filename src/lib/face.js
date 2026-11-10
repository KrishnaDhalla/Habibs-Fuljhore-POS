// Face check-in on the tablet.
// The camera picture never leaves the tablet: the app finds the face, works out its "face print" (128 numbers) and
// compares it with the prints the owner saved for each person (staff_faces). Only the match, how close it was, and a
// small photo of the face (for the owner to look at) are sent to the database.
//
// Real face or a photo held up? The person blinks or turns their head a little while the camera watches: a printed
// photo or a still picture on a phone does neither. A video on a phone could, so the small photo of every check-in is
// kept for the owner to see.
//
// The pure helpers (distance, matching, blink and head turn) have no browser code, so tests run them in Node.

export const MATCH = 0.5; // face prints closer than this are the same person (the database refuses above 0.55)
export const MARGIN = 0.06; // and the next closest person must be clearly further away
export const SAME_ENROLL = 0.45; // set-up: looks of one person must agree, and must not match someone else
const MODELS = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];
export const MODEL_FILES = MODELS.flatMap((m) => [`${m}-weights_manifest.json`, `${m}.bin`]);

// ---------------- pure helpers ----------------
export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// Who is it? faces: [{ staff_id, descriptors: [[128 numbers], ...] }]
// → { staff_id, distance, next } or { staff_id: null, reason } when no one, or two people, are close enough
export function bestMatch(descriptor, faces) {
  const per = faces
    .map((f) => ({ staff_id: f.staff_id, distance: Math.min(...(f.descriptors || []).map((d) => distance(descriptor, d))) }))
    .filter((x) => Number.isFinite(x.distance))
    .sort((a, b) => a.distance - b.distance);
  const [first, second] = per;
  if (!first || first.distance > MATCH) return { staff_id: null, reason: 'unknown', distance: first ? first.distance : null };
  if (second && second.distance - first.distance < MARGIN) return { staff_id: null, reason: 'unsure', distance: first.distance };
  return { staff_id: first.staff_id, distance: first.distance, next: second ? second.distance : null };
}

// Set-up: the looks agree with each other, and the face isn't already someone else's
export function checkEnroll(descriptors, others) {
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) if (distance(descriptors[i], descriptors[j]) > SAME_ENROLL) return { ok: false, reason: 'still' };
  }
  for (const o of others) {
    for (const d of descriptors) {
      const near = Math.min(...(o.descriptors || []).map((x) => distance(d, x)));
      if (near <= SAME_ENROLL) return { ok: false, reason: 'other', staff_id: o.staff_id, distance: near };
    }
  }
  return { ok: true };
}

const dist2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
// Eye openness from the 68 face points (eye aspect ratio): about 0.3 open, under 0.2 shut
export function eyeOpen(pts) {
  const one = (i) => (dist2(pts[i + 1], pts[i + 5]) + dist2(pts[i + 2], pts[i + 4])) / (2 * dist2(pts[i], pts[i + 3]));
  return (one(36) + one(42)) / 2;
}
// Where the nose tip is between the outer eye corners, along the line of the eyes: 0.5 looking straight,
// lower or higher when the head turns. Moving or tilting a flat photo keeps it the same.
export function headTurn(pts) {
  const a = pts[36];
  const b = pts[45];
  const n = pts[30];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  return ((n[0] - a[0]) * ex + (n[1] - a[1]) * ey) / (ex * ex + ey * ey);
}

// Watches the frames of one face: live once it has blinked or turned its head.
//  blink: the eyes drop under 55% of how open they usually are, and open again within a few frames
//  turn:  the nose moves 15% of the eye width (each value is the middle of 3 frames, so a shaky picture doesn't count)
// Measured with the real face models on photos held up and moved around (closer, tilted, shifted): the eyes looked
// down to 86% open at the least and the nose moved up to 6.5% (face at least 22% of the picture wide). Smaller faces
// wobble more, so the camera asks them to come closer first (MIN_FACE).
export const MIN_FACE = 0.22;
export const BLINK_DROP = 0.55;
export const BLINK_BACK = 0.9;
export const BLINK_FRAMES = 8;
export const TURN = 0.15;
const mid3 = (a, b, c) => a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
export function createLiveness() {
  let open = [];
  let eyes = 'open'; // open | shut | long (shut too long to be a blink: wait for them to open)
  let shutFor = 0;
  let raw = [];
  let turns = [];
  let how = null;
  return {
    push(pts) {
      if (how) return how;
      const e = eyeOpen(pts);
      raw.push(headTurn(pts));
      if (raw.length > 3) raw.shift();
      if (raw.length === 3) {
        turns.push(mid3(raw[0], raw[1], raw[2]));
        if (turns.length > 30) turns.shift();
      }
      const sorted = [...open].sort((x, y) => x - y);
      const base = sorted.length >= 4 ? sorted[Math.floor(sorted.length * 0.75)] : null;
      if (!base) {
        open.push(e);
      } else if (e < base * BLINK_DROP) {
        if (eyes === 'open') { eyes = 'shut'; shutFor = 1; }
        else if (eyes === 'shut' && ++shutFor > BLINK_FRAMES) eyes = 'long';
      } else if (e > base * BLINK_BACK) {
        if (eyes === 'shut') how = 'blink';
        eyes = 'open';
        open.push(e);
      } else if (eyes === 'shut') {
        if (++shutFor > BLINK_FRAMES) eyes = 'long';
      } else if (eyes === 'open') {
        open.push(e);
      }
      if (open.length > 20) open.shift();
      if (!how && turns.length >= 2 && Math.max(...turns) - Math.min(...turns) >= TURN) how = 'turn';
      return how;
    },
    reset() { open = []; eyes = 'open'; shutFor = 0; raw = []; turns = []; how = null; },
    get live() { return !!how; },
  };
}

// ---------------- browser: camera and the face models ----------------
let api = null;
let loading = null;
// Loads the face library and its 3 models (about 7 MB, once; the installed app keeps them for next time)
export function loadFace() {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = (async () => {
      const f = await import('@vladmandic/face-api');
      try { if (!(await f.tf.setBackend('webgl'))) await f.tf.setBackend('cpu'); } catch { await f.tf.setBackend('cpu'); }
      await f.tf.ready();
      const url = ((import.meta.env && import.meta.env.BASE_URL) || '/') + 'models';
      await Promise.all([f.nets.tinyFaceDetector.loadFromUri(url), f.nets.faceLandmark68Net.loadFromUri(url), f.nets.faceRecognitionNet.loadFromUri(url)]);
      api = f;
      return f;
    })().catch((e) => {
      loading = null;
      console.warn('face check-in:', e);
      throw new Error(/face check-in/i.test(e.message) ? e.message : 'The face check-in files could not load. Check the internet and try again.');
    });
  }
  return loading;
}

// The faces in a picture (video, image or canvas), biggest first:
// [{ descriptor: [128], points: [[x, y] × 68], box: { x, y, width, height }, score }]
export async function findFaces(input) {
  const f = await loadFace();
  const rows = await f.detectAllFaces(input, new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptors();
  return rows
    .map((r) => ({
      descriptor: Array.from(r.descriptor, (x) => Math.round(x * 1e5) / 1e5),
      points: r.landmarks.positions.map((p) => [p.x, p.y]),
      box: { x: r.detection.box.x, y: r.detection.box.y, width: r.detection.box.width, height: r.detection.box.height },
      score: r.detection.score,
    }))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
}

export async function openCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This device or browser has no camera access. Open the installed app on the tablet.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    if (e && e.name === 'NotAllowedError') throw new Error('The camera is blocked. Allow the camera for this app in the browser settings, then try again.');
    if (e && e.name === 'NotFoundError') throw new Error('No camera found on this device.');
    throw new Error('The camera could not open' + (e && e.message ? ': ' + e.message : '.'));
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => { video.onloadedmetadata = r; setTimeout(r, 3000); });
  return () => stream.getTracks().forEach((t) => t.stop());
}

// A small photo of the face (about 160 px, JPEG): kept with the check-in for the owner
export function facePhoto(video, box, size = 160) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const side = Math.max(box.width, box.height) * 1.6;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = Math.max(0, cx - side / 2);
  const y = Math.max(0, cy - side / 2);
  c.getContext('2d').drawImage(video, x, y, Math.min(side, video.videoWidth - x), Math.min(side, video.videoHeight - y), 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.7);
}
