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

// plain int64/uint64 only get 4-byte alignment on 386. atomic.* 64-bit
// types are the exception, they carry align64 and stay 8-aligned everywhere.
function align64(arch: Architecture): number {
  return arch === '386' ? 4 : 8;
}

export function getKnownTypeInfo(
  typeName: string,
  arch: Architecture
): KnownTypeInfo | undefined {
  const p = ptr(arch);
  const a64 = align64(arch);

  // generic instantiations like atomic.Pointer[T]
  const base = typeName.replace(/\[.*\]$/, '');

  switch (base) {
    // time
    case 'time.Time':
      // wall uint64 + ext int64 + loc *Location
      return { size: 8 + 8 + p, alignment: a64 };
    case 'time.Duration':
      return { size: 8, alignment: a64 };
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
      // state atomic.Uint64 (align64 on every arch) + sema uint32 + pad
      return { size: 16, alignment: 8 };
    case 'sync.Once':
      // done uint32 + m Mutex
      return { size: 12, alignment: 4 };
    case 'sync.Cond':
      // noCopy + L Locker (2 words) + notifyList (2 uint32 + uintptr + 2 ptrs)
      // + checker uintptr
      return { size: p * 2 + 8 + p * 3 + p, alignment: p };

    // atomic
    case 'atomic.Bool':
      // noCopy + v uint32
      return { size: 4, alignment: 4 };
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

    // stdlib interfaces: 2 words, same as any interface value
    case 'io.Reader':
    case 'io.Writer':
    case 'io.Closer':
    case 'io.Seeker':
    case 'io.ReadCloser':
    case 'io.WriteCloser':
    case 'io.ReadWriter':
    case 'io.ReadWriteCloser':
    case 'io.ReadSeeker':
    case 'io.ReaderAt':
    case 'io.WriterAt':
    case 'io.ByteReader':
    case 'io.ByteWriter':
    case 'io.RuneReader':
    case 'io.StringWriter':
    case 'fmt.Stringer':
    case 'fmt.Formatter':
    case 'sort.Interface':
    case 'sync.Locker':
    case 'http.Handler':
    case 'http.ResponseWriter':
    case 'http.RoundTripper':
    case 'http.CookieJar':
    case 'net.Conn':
    case 'net.Listener':
    case 'net.Addr':
    case 'error':
    case 'encoding.BinaryMarshaler':
    case 'encoding.TextMarshaler':
    case 'json.Marshaler':
    case 'json.Unmarshaler':
    case 'sql.Scanner':
    case 'driver.Valuer':
    case 'reflect.Type':
    case 'hash.Hash':
    case 'hash.Hash32':
    case 'hash.Hash64':
    case 'slog.Handler':
    case 'fs.File':
    case 'fs.FS':
    case 'fs.FileInfo':
    case 'fs.DirEntry':
    case 'rand.Source':
      return { size: p * 2, alignment: p };

    default:
      return undefined;
  }
}

export function isKnownType(typeName: string): boolean {
  // arch does not matter for existence check
  return getKnownTypeInfo(typeName, 'amd64') !== undefined;
}
