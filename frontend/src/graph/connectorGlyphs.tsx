/**
 * SVG sprite of connector glyphs. Inject `<ConnectorGlyphSprite />` once into
 * the top-level `<defs>` of any SVG that needs the glyphs; reference them
 * later with `<use href="#glyph-..." />`.
 *
 * Each glyph is authored in a 14×14 viewBox using `currentColor` for fill /
 * stroke, so callers can theme them via CSS by setting the text color of the
 * containing element.
 */

export const GLYPH_SIZE = 14;

/** Map a Power Query connector string (as emitted by parsers/m_query.py) to a
 *  glyph id. Returns "glyph-unknown" for connectors we don't have artwork for. */
export function connectorToGlyphId(connector: string | null | undefined): string {
  if (!connector) return "glyph-unknown";
  switch (connector) {
    case "GoogleBigQuery":
      return "glyph-bigquery";
    case "Sql.Database":
      return "glyph-sql";
    case "Snowflake":
      return "glyph-snowflake";
    case "AzureStorage":
    case "AzureStorage.DataLake":
      return "glyph-azure";
    case "Csv.Document":
    case "Excel.Workbook":
    case "Json.Document":
      return "glyph-file";
    case "Web.Contents":
      return "glyph-web";
    case "SharePoint":
      return "glyph-sharepoint";
    case "OData.Feed":
      return "glyph-odata";
    default:
      return "glyph-unknown";
  }
}

export function ConnectorGlyphSprite() {
  return (
    <>
      {/* SQL — cylinder (database barrel) */}
      <symbol id="glyph-sql" viewBox="0 0 14 14">
        <ellipse cx="7" cy="3" rx="4.5" ry="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M 2.5 3 V 11 A 4.5 1.5 0 0 0 11.5 11 V 3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M 2.5 7 A 4.5 1.5 0 0 0 11.5 7" fill="none" stroke="currentColor" strokeWidth="1.0" opacity="0.6" />
      </symbol>

      {/* BigQuery — stacked geometric shapes */}
      <symbol id="glyph-bigquery" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M 7 4 L 10 9 H 4 Z" fill="currentColor" opacity="0.85" />
        <line x1="10.5" y1="10.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </symbol>

      {/* Snowflake — 6-point star */}
      <symbol id="glyph-snowflake" viewBox="0 0 14 14">
        <g stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <line x1="7" y1="1.5" x2="7" y2="12.5" />
          <line x1="2.2" y1="4.3" x2="11.8" y2="9.7" />
          <line x1="2.2" y1="9.7" x2="11.8" y2="4.3" />
        </g>
        <g stroke="currentColor" strokeWidth="1.0" strokeLinecap="round" opacity="0.85">
          <path d="M 7 3 L 5.8 4.2 M 7 3 L 8.2 4.2" />
          <path d="M 7 11 L 5.8 9.8 M 7 11 L 8.2 9.8" />
        </g>
      </symbol>

      {/* Azure — cloud */}
      <symbol id="glyph-azure" viewBox="0 0 14 14">
        <path
          d="M 3 10 Q 1 10 1.2 8 Q 1.5 6 3.5 6 Q 4 4 6 4 Q 8 3.5 9 5.5 Q 12 5.5 12.5 8 Q 13 10 11 10 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </symbol>

      {/* File — dog-eared document */}
      <symbol id="glyph-file" viewBox="0 0 14 14">
        <path
          d="M 3 1.5 H 9 L 11.5 4 V 12.5 H 3 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M 9 1.5 V 4 H 11.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <line x1="5" y1="7" x2="9.5" y2="7" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
        <line x1="5" y1="9" x2="9.5" y2="9" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
      </symbol>

      {/* Web — globe */}
      <symbol id="glyph-web" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <ellipse cx="7" cy="7" rx="2.5" ry="5.2" fill="none" stroke="currentColor" strokeWidth="1.0" opacity="0.85" />
        <line x1="1.8" y1="7" x2="12.2" y2="7" stroke="currentColor" strokeWidth="1.0" opacity="0.85" />
      </symbol>

      {/* SharePoint — folder-plus-doc */}
      <symbol id="glyph-sharepoint" viewBox="0 0 14 14">
        <path
          d="M 1.5 4 H 6 L 7.5 5.5 H 12.5 V 11.5 H 1.5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <line x1="4" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
      </symbol>

      {/* OData — chained dots */}
      <symbol id="glyph-odata" viewBox="0 0 14 14">
        <circle cx="3" cy="7" r="1.6" fill="currentColor" />
        <circle cx="7" cy="7" r="1.6" fill="currentColor" />
        <circle cx="11" cy="7" r="1.6" fill="currentColor" />
        <line x1="4.6" y1="7" x2="5.4" y2="7" stroke="currentColor" strokeWidth="1.2" />
        <line x1="8.6" y1="7" x2="9.4" y2="7" stroke="currentColor" strokeWidth="1.2" />
      </symbol>

      {/* Calc-group — function fx pictogram */}
      <symbol id="glyph-calc-group" viewBox="0 0 14 14">
        <text
          x="7"
          y="10"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="9"
          fontStyle="italic"
          fontWeight="600"
          fill="currentColor"
        >
          fx
        </text>
      </symbol>

      {/* Unknown — dashed circle */}
      <symbol id="glyph-unknown" viewBox="0 0 14 14">
        <circle
          cx="7"
          cy="7"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2 1.5"
          opacity="0.7"
        />
      </symbol>
    </>
  );
}
