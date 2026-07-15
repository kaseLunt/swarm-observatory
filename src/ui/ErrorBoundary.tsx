import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Minimal render-phase safety net for the model-bearing subtree. React unmounts the whole tree on an
// uncaught render throw (white screen); a boundary catches it and shows the same `.screen.error`
// surface the decode/gate failures already use, so the operator sees the message instead of nothing
// and the header (run nav) stays reachable to recover. Belt-and-suspenders to the useRun/App selection
// invariant — no new deps, a plain React class component (getDerivedStateFromError +
// componentDidCatch are the only hooks that can catch a render-phase throw).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // SANCTIONED diagnostic output: an error boundary SHOULD log the caught render-phase throw (it is
    // the only record of what crashed the subtree) — this console.error is intentional, not a stray
    // debug leftover. Hygiene sweeps for console.* can skip this line.
    console.error('ErrorBoundary caught a render-phase error', error, info)
  }
  render(): ReactNode {
    if (this.state.error) {
      return <div className="screen error"><h1>render error</h1><pre>{this.state.error.message}</pre></div>
    }
    return this.props.children
  }
}
