import { ExternalLink } from 'lucide-react';

// Dependency-free SVG schematic map. It plots RELATIVE positions only (no street tiles).
// To use a real map later, swap this component for Leaflet/Google Maps - props stay the same.
//
// points: [{ key, label, latitude, longitude, kind: 'incident'|'ambulance'|'hospital', simulated }]
// Any point flagged `simulated` is drawn with a dashed ring and labelled SIMULATED -
// simulated coordinates are never presented as real GPS.

const W = 640;
const H = 360;
const PAD = 56;

const KIND = {
  incident: { color: '#dc2626', glyph: '!' },
  ambulance: { color: '#d97706', glyph: 'A' },
  hospital: { color: '#0d9488', glyph: 'H' },
};

function project(points) {
  const valid = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  if (!valid.length) return [];
  const lats = valid.map((p) => p.latitude);
  const lngs = valid.map((p) => p.longitude);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180); // equirectangular correction
  const xs = valid.map((p) => p.longitude * k);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const span = Math.max(maxX - minX, maxY - minY, 0.002); // avoid collapsing to a point
  const scale = Math.min((W - PAD * 2) / span, (H - PAD * 2) / span);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return valid.map((p) => ({
    ...p,
    x: W / 2 + (p.longitude * k - cx) * scale,
    y: H / 2 - (p.latitude - cy) * scale,
  }));
}

export default function TrackingMap({ points, anySimulated }) {
  const placed = project(points);
  const byKind = Object.fromEntries(placed.map((p) => [p.kind, p]));
  const route = [byKind.incident, byKind.ambulance, byKind.hospital].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="relative bg-slate-50">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Schematic map showing accident location, ambulance location and destination hospital">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#grid)" />
          {route.length > 1 && (
            <polyline points={route.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="6 6" />
          )}
          {placed.map((p) => {
            const { color, glyph } = KIND[p.kind];
            return (
              <g key={p.key} transform={`translate(${p.x} ${p.y})`}>
                {p.simulated && <circle r="22" fill="none" stroke={color} strokeWidth="2" strokeDasharray="4 3" />}
                <circle r="15" fill={color} stroke="#fff" strokeWidth="3" />
                <text textAnchor="middle" dy="5" fontSize="14" fontWeight="700" fill="#fff">
                  {glyph}
                </text>
                <text y="36" textAnchor="middle" fontSize="12" fontWeight="600" fill="#334155" paintOrder="stroke" stroke="#f8fafc" strokeWidth="4">
                  {p.label}
                </text>
                {p.simulated && (
                  <text y="50" textAnchor="middle" fontSize="10" fontWeight="700" fill={color} paintOrder="stroke" stroke="#f8fafc" strokeWidth="4">
                    SIMULATED
                  </text>
                )}
              </g>
            );
          })}
          {placed.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="14" fill="#64748b">
              No coordinates available to plot
            </text>
          )}
        </svg>
        <div className="absolute left-3 top-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">
          Schematic view · relative positions · not to scale
        </div>
        {anySimulated && (
          <div className="absolute right-3 top-3 rounded-lg bg-fuchsia-600 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm">
            SIMULATED DATA — NOT REAL GPS
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        {Object.entries({ incident: 'Accident location', ambulance: 'Ambulance', hospital: 'Destination hospital' }).map(([k, label]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND[k].color }} /> {label}
          </span>
        ))}
        {placed
          .filter((p) => !p.simulated)
          .map((p) => (
            <a
              key={p.key}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
              href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=16/${p.latitude}/${p.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {p.label} in OpenStreetMap <ExternalLink className="h-3 w-3" />
            </a>
          ))}
      </div>
    </div>
  );
}
