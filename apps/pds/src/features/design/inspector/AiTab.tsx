import { AiSuggestions } from '@/components/AiSuggestions';

/**
 * Design inspector's AI tab. The panel itself is shared with Grade — a
 * recommendation is scoped by workspace and selection, not by which inspector
 * is hosting it.
 */
export const AiTab = () => <AiSuggestions />;
