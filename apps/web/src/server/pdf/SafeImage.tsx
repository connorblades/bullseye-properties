import 'server-only';
import React from 'react';
import { Image, type ImageProps } from '@react-pdf/renderer';
import { loadPdfImage } from './image-source';

/** Only the fixed application wordmark may use the renderer's local-file loader. */
export function SafeImage({ src, ...props }: Omit<ImageProps, 'src' | 'source'> & { src: string }) {
  return <Image {...props} src={() => loadPdfImage(src)} />;
}
