/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { Api } from '../../preload'

declare global {
  interface Window {
    api: Api
  }
  namespace JSX { interface IntrinsicElements { webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string } } }
}

export {}
