// Holds the current access token IN MEMORY (mirrored to sessionStorage by AuthContext).
// Kept separate from api.js so mock and real backends share the same auth source.

let token = null;
let unauthorizedHandler = null;

export const getToken = () => token;
export const setToken = (t) => {
  token = t || null;
};
export const setUnauthorizedHandler = (fn) => {
  unauthorizedHandler = fn;
};
export const notifyUnauthorized = (message) => {
  if (unauthorizedHandler) unauthorizedHandler(message);
};
