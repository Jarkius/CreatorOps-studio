import type { UploadProgressEvent, UploadTransport } from '../features/assets/uploadFile.js';

/**
 * A scriptable stand-in for XMLHttpRequest. Every instance is recorded in `FakeXhr.instances` so a
 * test can see what was sent and then answer it: progress, a status, a network failure or a timeout.
 */
export class FakeXhr implements UploadTransport {
  static instances: FakeXhr[] = [];

  static reset(): void {
    FakeXhr.instances = [];
  }

  /** The most recent request, or a clear failure when a test expected one. */
  static last(): FakeXhr {
    const last = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (last === undefined) throw new Error('no upload request was made');
    return last;
  }

  method = '';
  url = '';
  readonly headers: Record<string, string> = {};
  body: Blob | null = null;
  sent = false;
  aborted = false;
  timeout = 0;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: UploadProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(body: Blob): void {
    this.sent = true;
    this.body = body;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.();
  }

  /** Reports byte progress, as the browser does during the PUT. */
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }

  /** The server answered. 204 is success; anything else is a failure with this body. */
  respond(status: number, responseText = ''): void {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }

  networkError(): void {
    this.onerror?.();
  }

  timedOut(): void {
    this.ontimeout?.();
  }
}
