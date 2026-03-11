import { randomBytes } from 'crypto';

let lastTimestampMs = -1;
let sequence = 0;

function nextTimestampAndSequence(): { timestampMs: number; seq: number } {
  let timestampMs = Date.now();

  if (timestampMs === lastTimestampMs) {
    sequence = (sequence + 1) & 0x0fff;

    // 동일 ms에서 4096개를 초과하면 다음 ms로 넘어갈 때까지 대기한다.
    if (sequence === 0) {
      do {
        timestampMs = Date.now();
      } while (timestampMs <= lastTimestampMs);

      lastTimestampMs = timestampMs;
      sequence = randomBytes(2).readUInt16BE(0) & 0x0fff;
    }
  } else {
    lastTimestampMs = timestampMs;
    sequence = randomBytes(2).readUInt16BE(0) & 0x0fff;
  }

  return { timestampMs, seq: sequence };
}

export function generateUuidV7(): string {
  const { timestampMs, seq } = nextTimestampAndSequence();
  const bytes = randomBytes(16);

  // 앞 48비트에 Unix epoch(ms)를 기록한다.
  const timestamp = BigInt(timestampMs);
  for (let i = 0; i < 6; i += 1) {
    const shift = BigInt((5 - i) * 8);
    bytes[i] = Number((timestamp >> shift) & 0xffn);
  }

  // version(7) + rand_a(12bit 중 상위 4bit)
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  // rand_a 하위 8bit
  bytes[7] = seq & 0xff;

  // variant는 RFC 4122 규격에 맞게 10xxxxxx로 설정한다.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
