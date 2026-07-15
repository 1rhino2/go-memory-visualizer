import { Architecture } from './types';

export interface KnownTypeInfo {
  size: number;
  alignment: number;
}

// Common stdlib types people drop into structs without defining them
// in the same file. Sizes match current Go layouts on each arch.
// We only cover types with a stable, well-known layout.

function ptr(arch: Architecture): number {
  return arch === '386' ? 4 : 8;
}

export function getKnownTypeInfo(
  typeName: string,
  arch: Architecture
): KnownTypeInfo | undefined {
  const p = ptr(arch);

  switch (typeName) {
    // time
    case 'time.Time':
      // wall uint64 + ext int64 + loc *Location
      return { size: 8 + 8 + p, alignment: 8 };
    case 'time.Duration':
      return { size: 8, alignment: 8 };
    case 'time.Location':
      // not usually embedded by value, but if it is treat as opaque pointer-ish
      return { size: p, alignment: p };

    // sync
    case 'sync.Mutex':
      // state int32 + sema uint32
      return { size: 8, alignment: 4 };
    case 'sync.RWMutex':
      // w Mutex + writerSem + readerSem + readerCount + readerWait
      // 8 + 4 + 4 + 4 + 4 = 24 on both arches (no pointers)
      return { size: 24, alignment: 4 };
    case 'sync.WaitGroup':
      // state atomic.Uint64 + sema uint32 + pad
      return { size: arch === '386' ? 12 : 16, alignment: 8 };
    case 'sync.Once':
      // done uint32 + m Mutex
      return { size: 12, alignment: 4 };
    case 'sync.Cond':
      // noCopy + Locker iface + notifyList + checker
      // Locker is 2 words; keep this conservative
      return { size: p * 2 + 16, alignment: p };

    // atomic
    case 'atomic.Bool':
      return { size: 1, alignment: 1 };
    case 'atomic.Int32':
    case 'atomic.Uint32':
      return { size: 4, alignment: 4 };
    case 'atomic.Int64':
    case 'atomic.Uint64':
      return { size: 8, alignment: 8 };
    case 'atomic.Uintptr':
    case 'atomic.Pointer':
      return { size: p, alignment: p };
    case 'atomic.Value':
      // holds an interface{}
      return { size: p * 2, alignment: p };

    // context
    case 'context.Context':
      return { size: p * 2, alignment: p };

    // common aliases people write without importing visible defs
    case 'json.RawMessage':
      return { size: p * 3, alignment: p }; // []byte header

    default:
      return undefined;
  }
}

export function isKnownType(typeName: string): boolean {
  // arch does not matter for existence check
  return getKnownTypeInfo(typeName, 'amd64') !== undefined;
}
