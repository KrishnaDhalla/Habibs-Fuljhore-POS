// Staff list → a person: face check-in set-up and their documents (owner only).
import { useEffect, useRef, useState } from 'react';
import { ScanFace, Upload, Eye, Trash2, FileText, Download, AlertTriangle } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { uid, fmtDate, canDownload, NO_DOWNLOAD } from '../lib/format';
import { Modal, Field, Confirm } from './ui';
import { loadFace, findFaces, openCamera, facePhoto, checkEnroll, MIN_FACE } from '../lib/face';

// ---------------- Face check-in set-up ----------------
export function FaceSection({ person }) {
  const { toast, staff } = useApp();
  const [face, setFace] = useState(undefined);
  const [setup, setSetup] = useState(false);
  const [del, setDel] = useState(false);
  const load = () => db.list('staff_faces', { eq: { staff_id: person.id }, select: 'staff_id,photo,consent_at,created_at,updated_at' }).then((r) => setFace(r[0] || null)).catch(() => setFace(null));
  useEffect(() => { load(); }, [person.id]);
  return (
    <div className="sub-card" id="face-section">
      <div className="row between wrap">
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          {face && face.photo ? <img className="ci-thumb" src={face.photo} alt="" /> : <span className="ci-thumb empty"><ScanFace size={18} /></span>}
          <div>
            <b>Face check-in</b>
            <div className="small muted">
              {face === undefined ? 'Checking…' : face ? `Set up ${fmtDate(face.updated_at || face.created_at)} · agreed ${fmtDate(face.consent_at)}` : 'Not set up. Without it, the owner marks attendance by hand.'}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn line sm" id="face-setup" onClick={() => setSetup(true)}><ScanFace size={15} /> {face ? 'Set up again' : 'Set up'}</button>
          {face && <button className="btn danger sm" onClick={() => setDel(true)}>Remove</button>}
        </div>
      </div>
      {setup && <FaceSetup person={person} others={staff.filter((s) => s.id !== person.id)} onClose={() => setSetup(false)} onSaved={() => { setSetup(false); toast('Face check-in is set up'); load(); }} />}
      {del && (
        <Confirm title="Remove face check-in?" okLabel="Remove" danger onClose={() => setDel(false)}
          onOk={async () => {
            try {
              await db.removeWhere('staff_faces', { staff_id: person.id });
              toast('Face check-in removed');
            } catch (e) { toast(e.message, 'bad'); }
            setDel(false);
            load();
          }}
          text={`${person.name}'s face print is deleted. Past check-ins and their photos stay in attendance.`} />
      )}
    </div>
  );
}

const LOOKS = 5;
function FaceSetup({ person, others, onClose, onSaved }) {
  const { user } = useApp();
  const video = useRef(null);
  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState('ask'); // ask | loading | look | check | error
  const [msg, setMsg] = useState('');
  const [got, setGot] = useState(0);
  const [err, setErr] = useState('');
  const stopRef = useRef(null);
  const deadRef = useRef(false);
  useEffect(() => () => { deadRef.current = true; if (stopRef.current) stopRef.current(); }, []);

  const start = async () => {
    setErr('');
    setPhase('loading');
    setMsg('Getting the camera ready…');
    try {
      const [faces] = await Promise.all([db.list('staff_faces', {}), loadFace()]);
      if (deadRef.current) return;
      if (!stopRef.current) stopRef.current = await openCamera(video.current);
      setPhase('look');
      const looks = [];
      let photo = null;
      let last = 0;
      const t0 = Date.now();
      while (looks.length < LOOKS && !deadRef.current) {
        if (Date.now() - t0 > 45000) throw new Error('No clear face in 45 seconds. Try again in better light, face in the middle.');
        const v = video.current;
        const found = v.videoWidth ? await findFaces(v) : [];
        if (!found.length) setMsg(`Look at the camera, ${person.name.split(' ')[0]}`);
        else if (found.length > 1 && found[1].box.width > found[0].box.width * 0.6) setMsg('Only the person being set up, please');
        else if (found[0].box.width < v.videoWidth * MIN_FACE) setMsg('Come a little closer');
        else if (found[0].score < 0.7) setMsg('Face the camera, in good light');
        else if (Date.now() - last > 350) {
          looks.push(found[0].descriptor);
          if (!photo) photo = facePhoto(v, found[0].box, 120);
          last = Date.now();
          setGot(looks.length);
          setMsg(looks.length < LOOKS ? 'Good. Now turn your head slowly a little left and right' : 'Done');
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      if (deadRef.current) return;
      setPhase('check');
      const otherFaces = faces.filter((f) => f.staff_id !== person.id && others.some((o) => o.id === f.staff_id));
      const c = checkEnroll(looks, otherFaces);
      if (!c.ok && c.reason === 'still') throw new Error('The looks did not agree. Keep the face in the frame and try again.');
      if (!c.ok && c.reason === 'other') {
        const o = others.find((x) => x.id === c.staff_id);
        throw new Error(`This face looks like ${o ? o.name : 'someone else'}'s face check-in. Each person sets up their own face.`);
      }
      await db.upsert('staff_faces', { staff_id: person.id, descriptors: looks, photo, consent_at: new Date().toISOString(), created_by: (user && user.email) || 'owner' }, 'staff_id');
      if (stopRef.current) { stopRef.current(); stopRef.current = null; }
      onSaved();
    } catch (e) {
      if (deadRef.current) return;
      setErr(e.message);
      setPhase('error');
      setGot(0);
    }
  };

  return (
    <Modal title={`Face check-in: ${person.name}`} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Close</button>
        {(phase === 'ask' || phase === 'error') && <button className="btn primary" id="face-start" disabled={!agree} onClick={start}>{phase === 'error' ? 'Try again' : 'Start camera'}</button>}</>}>
      <div className="stack">
        {(phase === 'ask' || phase === 'error') && (
          <label className="check" id="face-consent">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{person.name} agrees to face check-in. The app keeps a face print (numbers worked out from the face, not a photo), one small photo
              from this set-up, and a small photo at each check-in, so the owner can see who checked in. They can ask for it to be removed at any time.</span>
          </label>
        )}
        <div className={'face-cam' + (phase === 'ask' ? ' hidden' : '')}>
          <video ref={video} playsInline muted autoPlay className={phase === 'error' ? 'hidden' : ''} />
          {(phase === 'loading' || phase === 'look' || phase === 'check') && (
            <div className="face-msg" role="status">{phase === 'loading' && <div className="spinner" />} {phase === 'check' ? 'Saving…' : msg}{phase === 'look' && ` (${got} of ${LOOKS})`}</div>
          )}
          {phase === 'error' && <div className="face-error"><AlertTriangle size={20} /><p>{err}</p></div>}
        </div>
        <p className="small muted">Set up on the tablet used for check-in, in the light at the counter. Glasses on if they usually wear them.</p>
      </div>
    </Modal>
  );
}

// ---------------- Documents ----------------
export const DOC_KINDS = [['aadhaar', 'Aadhaar'], ['pan', 'PAN'], ['photo', 'Photo'], ['bank', 'Bank details'], ['address', 'Address proof'], ['certificate', 'Certificate'], ['agreement', 'Agreement'], ['other', 'Other']];
const DOC_LABEL = Object.fromEntries(DOC_KINDS);
const MAX_BYTES = 5 * 1024 * 1024;

// Photos of documents are made smaller (1800 px, JPEG) before upload; PDFs go as they are
export async function shrinkImage(file, max = 1800, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.type === 'image/heic') return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not open the photo')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (k === 1 && file.size < 700 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', quality));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const cleanPan = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
export const validPan = (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v);
export const docNumberText = (d) => (!d.number ? '' : d.kind === 'aadhaar' ? `XXXX XXXX ${d.number}` : d.number);

export function DocsSection({ person }) {
  const { toast, user } = useApp();
  const [docs, setDocs] = useState(null);
  const [kind, setKind] = useState('aadhaar');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState(null);
  const [del, setDel] = useState(null);
  const fileRef = useRef(null);
  const load = () => db.list('staff_documents', { eq: { staff_id: person.id }, order: ['created_at', 'desc'] }).then(setDocs).catch((e) => { setDocs([]); setErr(e.message); });
  useEffect(() => { load(); }, [person.id]);
  useEffect(() => () => { if (view && view.url) URL.revokeObjectURL(view.url); }, [view]);

  const add = async () => {
    setErr('');
    let num = number.trim();
    if (kind === 'aadhaar') {
      num = num.replace(/\D/g, '');
      if (num.length > 4) return setErr('For Aadhaar, keep only the last 4 digits (the app never stores the full number).');
      if (num && num.length !== 4) return setErr('Enter the last 4 digits of the Aadhaar number, or leave it empty.');
    }
    if (kind === 'pan') {
      num = cleanPan(num);
      if (num && !validPan(num)) return setErr('PAN looks like ABCDE1234F.');
    }
    if (!file && !num) return setErr('Choose a photo or PDF of the document, or enter its number.');
    setBusy(true);
    let path = null;
    try {
      let f = null;
      if (file) {
        f = await shrinkImage(file);
        if (f.size > MAX_BYTES) throw new Error('The file is bigger than 5 MB. Take a photo instead, or make the PDF smaller.');
        if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) throw new Error('Use a photo (JPEG, PNG) or a PDF.');
        const ext = f.type === 'application/pdf' ? 'pdf' : f.type.split('/')[1].replace('jpeg', 'jpg');
        path = `${person.id}/${uid()}.${ext}`;
        await db.files.upload(path, f);
      }
      await db.insert('staff_documents', {
        staff_id: person.id, kind, number: num || null, note: note.trim() || null, file_path: path,
        file_name: file ? file.name.slice(0, 120) : null, mime: f ? f.type : null, size_bytes: f ? f.size : null, created_by: (user && user.email) || 'owner',
      });
      toast(`${DOC_LABEL[kind]} added`);
      setNumber('');
      setNote('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      if (path) db.files.remove([path]).catch(() => {});
      setErr(e.message);
    }
    setBusy(false);
  };

  const open = async (d) => {
    try {
      const blob = await db.files.download(d.file_path);
      const url = URL.createObjectURL(blob);
      if ((d.mime || blob.type) === 'application/pdf') {
        if (!canDownload()) { URL.revokeObjectURL(url); return toast(NO_DOWNLOAD); }
        const a = document.createElement('a');
        a.href = url;
        a.download = `${person.name} ${DOC_LABEL[d.kind]}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else setView({ d, url });
    } catch (e) { toast(e.message, 'bad'); }
  };
  const remove = async (d) => {
    try {
      await db.remove('staff_documents', d.id);
      if (d.file_path) await db.files.remove([d.file_path]).catch(() => {});
      toast('Deleted');
      setDel(null);
      load();
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <div className="sub-card" id="docs-section">
      <b>Documents</b>
      <p className="small muted" style={{ margin: '2px 0 10px' }}>Only the owner can see these. Kept in private storage.</p>
      {docs && docs.length > 0 && (
        <div className="doc-list">
          {docs.map((d) => (
            <div className="doc-row" key={d.id}>
              <FileText size={18} />
              <div className="grow">
                <div className="strong">{DOC_LABEL[d.kind] || d.kind}{d.number ? ` · ${docNumberText(d)}` : ''}</div>
                <div className="tiny muted">{[d.file_name, d.size_bytes ? Math.max(1, Math.round(d.size_bytes / 1024)) + ' KB' : null, fmtDate(d.created_at), d.note].filter(Boolean).join(' · ')}</div>
              </div>
              {d.file_path && (
                <button className="icon-btn plain sm" aria-label={'Open ' + (DOC_LABEL[d.kind] || d.kind)} onClick={() => open(d)}>
                  {d.mime === 'application/pdf' ? <Download size={16} /> : <Eye size={16} />}
                </button>
              )}
              <button className="icon-btn plain sm" aria-label={'Delete ' + (DOC_LABEL[d.kind] || d.kind)} onClick={() => setDel(d)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
      {docs && docs.length === 0 && <p className="small muted">No documents yet.</p>}
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="chips">{DOC_KINDS.map(([k, l]) => <button key={k} type="button" className={'chip sm' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); setNumber(''); }}>{l}</button>)}</div>
        <div className="form-grid">
          {['aadhaar', 'pan', 'bank'].includes(kind) && (
            <Field label={kind === 'aadhaar' ? 'Last 4 digits' : kind === 'pan' ? 'PAN number' : 'Account (last 4) / IFSC'}
              hint={kind === 'aadhaar' ? 'Use the masked Aadhaar (from the UIDAI site) as the file: it shows only the last 4 digits.' : undefined}>
              <input className="input" id="doc-number" value={number} inputMode={kind === 'aadhaar' ? 'numeric' : 'text'} maxLength={kind === 'aadhaar' ? 4 : 30}
                onChange={(e) => setNumber(kind === 'aadhaar' ? e.target.value.replace(/\D/g, '').slice(0, 4) : kind === 'pan' ? cleanPan(e.target.value) : e.target.value.slice(0, 30))} />
            </Field>
          )}
          <Field label="Note (optional)"><input className="input" id="doc-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></Field>
          <Field label="Photo or PDF" hint="Up to 5 MB. Photos are made smaller.">
            <input ref={fileRef} className="input" id="doc-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
          </Field>
        </div>
        {err && <p className="err-text">{err}</p>}
        <div><button className="btn line sm" id="doc-add" disabled={busy} onClick={add}><Upload size={15} /> {busy ? 'Uploading…' : 'Add document'}</button></div>
      </div>
      {view && (
        <Modal wide title={`${person.name}: ${DOC_LABEL[view.d.kind] || view.d.kind}`} onClose={() => setView(null)}>
          <img className="doc-view" src={view.url} alt={DOC_LABEL[view.d.kind]} />
        </Modal>
      )}
      {del && <Confirm title={`Delete ${DOC_LABEL[del.kind] || 'document'}?`} okLabel="Delete" danger onClose={() => setDel(null)} onOk={() => remove(del)} text="The file is deleted from storage too." />}
    </div>
  );
}
