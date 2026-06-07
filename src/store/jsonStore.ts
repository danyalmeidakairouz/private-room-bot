import * as fs from 'fs';
import * as path from 'path';

export class JsonStore<V> {
  private readonly filePath: string;
  private data: Record<string, V>;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.data = {};

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        this.data = JSON.parse(raw) as Record<string, V>;
      }
      catch {
        console.warn(`[JsonStore] Could not parse ${filePath} — starting with empty store.`);
        this.data = {};
      }
    }
  }

  all(): Record<string, V> {
    return { ...this.data };
  }

  get(key: string): V | undefined {
    return this.data[key];
  }

  set(key: string, value: V): void {
    this.data[key] = value;
    this.persist();
  }

  delete(key: string): void {
    delete this.data[key];
    this.persist();
  }

  private persist(): void {
    // Write to a temp file then rename so a crash mid-write never truncates the live file.
    // rename() within the same filesystem is atomic — readers never see a partial JSON file.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}
