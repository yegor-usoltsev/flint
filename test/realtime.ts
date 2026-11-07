export class Source extends EventTarget {
  static readonly CLOSED = 2;
  static readonly CONNECTING = 0;
  static readonly behavior = { blocked: false };
  static readonly OPEN = 1;
  static readonly instances: Source[] = [];
  readyState = 0;
  url: string;

  constructor(url: string) {
    super();

    if (Source.behavior.blocked) {
      throw new Error("blocked");
    }

    this.url = url;
    Source.instances.push(this);
  }

  close() {
    this.readyState = Source.CLOSED;
  }

  open() {
    this.readyState = Source.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  fail() {
    this.close();
    this.dispatchEvent(new Event("error"));
  }

  message(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
