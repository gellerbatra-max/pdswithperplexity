/**
 * DXF tokeniser and document model.
 *
 * DXF is a flat stream of (group code, value) line pairs. Everything above
 * this module works with the structure it produces, not the stream.
 *
 * Pure: no DOM, no worker APIs. Runs identically in a test and in a worker.
 */

export interface DxfPair {
  readonly code: number;
  readonly value: string;
}

export interface DxfEntity {
  readonly type: string;
  readonly pairs: DxfPair[];
  /**
   * POLYLINE carries its geometry in following VERTEX entities, and INSERT
   * carries its metadata in following ATTRIB entities. Both are collected
   * here so callers never walk the stream themselves.
   */
  readonly children: DxfEntity[];
}

export interface DxfBlock {
  readonly name: string;
  readonly basePoint: { x: number; y: number };
  readonly entities: DxfEntity[];
}

export interface DxfDocument {
  readonly entities: DxfEntity[];
  readonly blocks: Map<string, DxfBlock>;
  readonly header: Map<string, string>;
}

/** Entities that can own the entities that follow them, until SEQEND. */
const OWNER_TYPES = new Set(['POLYLINE', 'INSERT']);

/**
 * Entities that are never standalone — they belong to the owner above them.
 *
 * Ownership is decided by the child's type rather than by the owner declaring
 * it, because an INSERT with no attributes is not followed by a SEQEND. Keying
 * off the owner would leave it collecting whatever came next.
 */
const CHILD_TYPES = new Set(['ATTRIB', 'ATTDEF', 'VERTEX']);

export const tokenize = (text: string): DxfPair[] => {
  // DXF files come off Windows systems, and some writers pad the code column.
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: DxfPair[] = [];

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const rawCode = lines[i];
    const rawValue = lines[i + 1];
    if (rawCode === undefined || rawValue === undefined) break;

    const code = Number.parseInt(rawCode.trim(), 10);
    // A non-numeric code means the pairing has slipped; there is no way to
    // resynchronise a stream of pairs, so stop rather than emit nonsense.
    if (!Number.isFinite(code)) break;

    pairs.push({ code, value: rawValue.trim() });
  }

  return pairs;
};

/** First value for a group code, or undefined. */
export const valueOf = (entity: DxfEntity, code: number): string | undefined =>
  entity.pairs.find((pair) => pair.code === code)?.value;

export const numberOf = (entity: DxfEntity, code: number, fallback: number): number => {
  const raw = valueOf(entity, code);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const layerOf = (entity: DxfEntity): string => valueOf(entity, 8) ?? '0';

const readEntities = (
  pairs: readonly DxfPair[],
  start: number,
  stopAt: ReadonlySet<string>,
): { entities: DxfEntity[]; next: number } => {
  const entities: DxfEntity[] = [];
  let index = start;
  let current: { type: string; pairs: DxfPair[]; children: DxfEntity[] } | null = null;
  // The entity currently collecting children, if any.
  let owner: { type: string; pairs: DxfPair[]; children: DxfEntity[] } | null = null;

  const flush = () => {
    if (!current) return;
    if (owner && CHILD_TYPES.has(current.type)) {
      owner.children.push(current);
    } else {
      entities.push(current);
      // A standalone entity ends the previous owner's run.
      owner = OWNER_TYPES.has(current.type) ? current : null;
    }
    current = null;
  };

  while (index < pairs.length) {
    const pair = pairs[index];
    if (!pair) break;

    if (pair.code === 0) {
      flush();

      if (stopAt.has(pair.value)) return { entities, next: index };

      if (pair.value === 'SEQEND') {
        owner = null;
        index += 1;
        continue;
      }

      current = { type: pair.value, pairs: [], children: [] };
      index += 1;
      continue;
    }

    current?.pairs.push(pair);
    index += 1;
  }

  flush();
  return { entities, next: index };
};

const SECTION_END = new Set(['ENDSEC']);
const BLOCK_END = new Set(['ENDBLK']);

export const parseDocument = (text: string): DxfDocument => {
  const pairs = tokenize(text);
  const entities: DxfEntity[] = [];
  const blocks = new Map<string, DxfBlock>();
  const header = new Map<string, string>();

  let index = 0;
  while (index < pairs.length) {
    const pair = pairs[index];
    if (!pair) break;

    if (pair.code !== 0 || pair.value !== 'SECTION') {
      index += 1;
      continue;
    }

    const namePair = pairs[index + 1];
    const section = namePair?.code === 2 ? namePair.value : '';
    index += 2;

    if (section === 'ENTITIES') {
      const read = readEntities(pairs, index, SECTION_END);
      entities.push(...read.entities);
      index = read.next;
      continue;
    }

    if (section === 'BLOCKS') {
      index = readBlocks(pairs, index, blocks);
      continue;
    }

    if (section === 'HEADER') {
      index = readHeader(pairs, index, header);
      continue;
    }

    index += 1;
  }

  return { entities, blocks, header };
};

const readBlocks = (
  pairs: readonly DxfPair[],
  start: number,
  blocks: Map<string, DxfBlock>,
): number => {
  let index = start;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (!pair) break;
    if (pair.code === 0 && pair.value === 'ENDSEC') return index;

    if (pair.code === 0 && pair.value === 'BLOCK') {
      index += 1;
      const headerPairs: DxfPair[] = [];
      while (index < pairs.length) {
        const inner = pairs[index];
        if (!inner || inner.code === 0) break;
        headerPairs.push(inner);
        index += 1;
      }

      const blockHeader: DxfEntity = { type: 'BLOCK', pairs: headerPairs, children: [] };
      const read = readEntities(pairs, index, BLOCK_END);
      const name = valueOf(blockHeader, 2) ?? '';
      blocks.set(name, {
        name,
        basePoint: { x: numberOf(blockHeader, 10, 0), y: numberOf(blockHeader, 20, 0) },
        entities: read.entities,
      });
      index = read.next;
      continue;
    }

    index += 1;
  }

  return index;
};

const readHeader = (
  pairs: readonly DxfPair[],
  start: number,
  header: Map<string, string>,
): number => {
  let index = start;
  let variable = '';

  while (index < pairs.length) {
    const pair = pairs[index];
    if (!pair) break;
    if (pair.code === 0 && pair.value === 'ENDSEC') return index;
    if (pair.code === 9) variable = pair.value;
    else if (variable !== '' && !header.has(variable)) header.set(variable, pair.value);
    index += 1;
  }

  return index;
};
