export interface FeatureCodeProfile {
	id: string;
	language: string;
	runtime: string;
	framework: string | null;
}

/** Profiles describe what Specsplice can scaffold and verify in isolation. */
export const featureCodeProfiles: readonly FeatureCodeProfile[] = [
	{ id: 'node.esm', language: 'JavaScript', runtime: 'Node.js 24.22.1', framework: null }
];

export type FeatureCodeValue = null | boolean | number | string | FeatureCodeValue[] | { [key: string]: FeatureCodeValue };

export interface FeatureCodeCase {
	id: string;
	featureId: string;
	criterionId?: string;
	input: FeatureCodeValue;
	expected: FeatureCodeValue;
}

function isCaseValue(value: unknown, depth = 0): value is FeatureCodeValue {
	if (depth > 24) { return false; }
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) { return true; }
	if (Array.isArray(value) && value.length > 1000) { return false; }
	return typeof value === 'object' && Object.values(value).every(entry => isCaseValue(entry, depth + 1));
}

/** Parse the independently authored case document used by the wizard and project fixture. */
export function parseFeatureCodeCases(text: string): FeatureCodeCase[] {
	if (text.length > 128 * 1024) { throw new Error('featureCodeCasesTooLarge'); }
	const document: { version?: unknown; cases?: unknown } | null = JSON.parse(text);
	if (document?.version !== 1 || !Array.isArray(document.cases) || document.cases.length < 1 || document.cases.length > 100) { throw new Error('invalidFeatureCodeCases'); }
	const ids = new Set<string>();
	for (const item of document.cases) {
		if (!item || typeof item !== 'object' || ![item.id, item.featureId, item.criterionId ?? 'criterion'].every(id => typeof id === 'string' && id.trim() === id && id.length >= 1 && id.length <= 120) || ids.has(item.id) || !isCaseValue(item.input) || !isCaseValue(item.expected)) { throw new Error('invalidFeatureCodeCases'); }
		ids.add(item.id);
	}
	return document.cases;
}

export interface FeatureCodeGenerationSetup {
	mode: 'create' | 'update';
	profiles: readonly FeatureCodeProfile[];
	defaultProfileId?: string;
	supportProblem?: string;
	featureIds?: string[];
}

export interface FeatureCodeGenerationRequest {
	profileId: string;
	featureIds: string[];
	intent?: string;
	cases?: FeatureCodeCase[];
}

export interface FeatureCodeGenerationRun {
	id: string;
	root: string;
	mode: FeatureCodeGenerationSetup['mode'];
	profileId: string;
	status: 'prepared' | 'generating' | 'waitingUser' | 'ready' | 'verified' | 'failed' | 'applied' | 'undone' | 'interrupted';
	featureIds: string[];
	tasks: { id: string; name: string; status: 'pending' | 'running' | 'ready' | 'waitingUser' | 'failed'; gaps: string[]; diagramIds?: string[]; criterionIds?: string[] }[];
	files: { file: string; kind: 'create' | 'update' | 'delete'; featureId?: string }[];
	questions?: string[];
	reviewId?: string;
	verification?: { passed: boolean; cases?: { id: string; featureId: string; passed: boolean; message?: string }[]; output?: string };
}

export interface FeatureCodeDiff {
	before: string | null;
	after: string | null;
}
