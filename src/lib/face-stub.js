// The one-file preview (npm run build:demo) has no face models, so it uses this instead of the face library.
const no = () => {
  throw new Error('Face check-in works in the installed app on the tablet. This preview has no face models.');
};
export const tf = { setBackend: no, ready: no };
export const nets = {};
