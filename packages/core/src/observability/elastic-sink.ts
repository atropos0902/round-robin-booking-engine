import { Client } from '@elastic/elasticsearch';

const MAX_BUFFER = 2000;

/** Buffers log lines and sends them in one bulk request. Losing Elastic never fails a request. */
export class ElasticSink {
  private buffer: string[] = [];
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: Client,
    private readonly index: string,
  ) {}

  static connect(node: string, apiKey?: string): ElasticSink {
    const client = new Client({ node, ...(apiKey ? { auth: { apiKey } } : {}), requestTimeout: 3000, maxRetries: 1 });
    return new ElasticSink(client, process.env.ELASTIC_INDEX ?? 'logs-booking-default');
  }

  write(line: string): void {
    if (this.buffer.length < MAX_BUFFER) this.buffer.push(line);
  }

  flush(): Promise<void> {
    this.inFlight = this.inFlight.then(() => this.send());
    return this.inFlight;
  }

  private async send(): Promise<void> {
    const lines = this.buffer;
    if (lines.length === 0) return;
    this.buffer = [];
    try {
      // Data streams only accept create.
      const operations = lines.flatMap((line) => [{ create: { _index: this.index } }, JSON.parse(line)]);
      const result = await this.client.bulk({ operations });
      if (result.errors) process.stderr.write('elastic rejected some log lines\n');
    } catch (error) {
      process.stderr.write(`elastic unreachable: ${(error as Error).message}\n`);
    }
  }
}
