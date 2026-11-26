/* Vul hier je publieke sleutels in. Beide zijn bedoeld om publiek te zijn (de anon key wordt beschermd door de toegangsregels in de database,
   de Mapbox-token beperk je tot je eigen webadressen). Zet hier NOOIT de service_role key of de Anthropic-sleutel. */
window.ARROWLINE_CONFIG = {
  supabaseUrl: "https://hsvywpbtanwsaoprviqw.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzdnl3cGJ0YW53c2FvcHJ2aXF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MTI1MTIsImV4cCI6MjExMTE4ODUxMn0.mlVEHQuCpowT4_wMDXqFJH_zE_8OMh36HC9jxRNBs10",   // Supabase → Project Settings → API → anon public
  mapboxToken: ""        // Mapbox → Access tokens → public token (pk....), beperkt tot je webadressen
};
