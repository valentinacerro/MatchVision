// The Django API runs on port 8001 of the same machine that serves the app.
// Using the page's hostname makes it work both on localhost and from a tablet on the LAN
// (e.g. http://192.168.1.20:4200 talks to http://192.168.1.20:8001).
export const API_URL = `${window.location.protocol}//${window.location.hostname}:8001`
