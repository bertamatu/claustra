// User helper that happens to share the React 19 hook's name. The A05 rule
// must only fire when the local binding came from `react-dom`.
export const useFormStatus = (): { pending: boolean } => ({ pending: false });
