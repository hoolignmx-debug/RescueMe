# MediRescue AI

Browser demo of the emergency scan flow: camera or photo, quality check, face embedding, GPS and timestamp, encrypted request to a mock backend.

## Run in VS Code
1. Open this folder in VS Code.
2. Install the "Live Server" extension, right-click `index.html`, choose "Open with Live Server".
   Or run `python -m http.server 5500` in this folder and open http://localhost:5500
3. Allow camera and location when the browser asks (they need localhost or https).

## Files
- index.html: page structure
- style.css: styles and light/dark theme
- app.js: capture, quality check, features, embedding, location, encryption, mock backend

## Next steps
- Replace the demo embedding in `computeFeatures()` with a trained face model (for example MobileFaceNet via ONNX Runtime Web or TensorFlow.js).
- Replace the mock backend in the `#send` handler with a real `fetch()` POST to your server over HTTPS.
