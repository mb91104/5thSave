import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Last line of defence: a rendering error must never leave a blank page.
// React error #31 ("objects are not valid as a React child") used to unmount
// the whole app when an API error object reached the DOM.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('5thSave crashed while rendering:', error, info)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{ maxWidth: 560, margin: '12vh auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#555', marginBottom: 16 }}>
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <pre style={{ fontSize: 12, color: '#8a1c1c', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
            {String(error?.message || error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: '10px 16px', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
