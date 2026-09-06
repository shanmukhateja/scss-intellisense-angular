'use strict';

/**
 * Cheap plain-substring gate applied before the TypeScript parser is invoked for
 * a `.ts` file: the source must mention both `@Component` and `styles`.
 * `@Component` is tested first so services, guards and most modules bail
 * immediately. The `styles` test also matches `styleUrls`/`styleUrl` — harmless,
 * such a file simply yields zero style spans downstream.
 */
export function hasComponentStyles(text: string): boolean {
	return text.includes('@Component') && text.includes('styles');
}
