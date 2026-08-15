export interface GraphClockPort {
  now(): Date;
}

export interface GraphDigestPort {
  digest(input: Uint8Array): Promise<string>;
}

export interface GraphCancellationPort {
  readonly aborted: boolean;
  throwIfAborted(): void;
}
