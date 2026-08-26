/**
 * Temporary single-user configuration.
 *
 * Voltline is intentionally running without Supabase while the local product
 * workflow is being developed. This is not production authentication: switch
 * LOCAL_ONLY off only when a real server-side session has replaced it.
 */
export const LOCAL_ONLY = true;
export const LOCAL_USERNAME = "1";
export const LOCAL_PASSWORD = "";

