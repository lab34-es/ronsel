# Lab34 Flows Frontend

React frontend for the Lab34 Flows CLI tool, built with Vite and MUI Joy components.

## Features

- **Dashboard**: Overview of system status, flows, and applications
- **Flow Management**: Browse and execute flow definitions
- **Applications**: View and configure available applications
- **AI Integration**: Generate flows using natural language prompts
- **Real-time Updates**: Socket.IO integration for live flow execution monitoring

## Technology Stack

- **Vite** - Fast build tool and development server
- **React 18** - Modern React with hooks
- **MUI Joy** - Material-UI Joy design system
- **React Router** - Client-side routing
- **Socket.IO Client** - Real-time communication
- **Axios** - HTTP client with interceptors

## Environment Variables

The application uses Vite's environment variable system:

- `VITE_API_URL` - Backend API URL (default: http://localhost:5678)

Create a `.env` file in the frontend directory to customize:

```env
VITE_API_URL=http://localhost:5678
```

## Development

The frontend runs on port 3000 and proxies API requests to the backend, which
is on port 3001 unless `PORT` says otherwise -- the API reads the same
variable, so `PORT=3005 npm run dev` from the root moves both.

The built bundle has no port in it at all: it calls the origin that served it
(`src/services/api.ts` and `src/services/socket.ts`), which is how the API can
pick a free port at start and still be found.

### Available Scripts

- `npm run dev` - Start Vite development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm test` - Run tests

### Running with Backend

From the root directory:

```bash
# Install frontend dependencies
npm run install:frontend

# Run both API and frontend together
npm run dev:full

# Or run separately:
npm run dev        # API only (port 3001)
npm run frontend   # Frontend only (port 3000)
```

## Project Structure

```
src/
├── components/
│   ├── Layout/           # Main layout with sidebar navigation
│   ├── Dashboard/        # Dashboard with system overview
│   ├── FlowList/         # Flow definitions browser
│   └── ApplicationsList/ # Applications management
├── services/
│   └── api.js           # Axios configuration and API methods
├── hooks/               # Custom React hooks
└── utils/               # Utility functions
```

## API Integration

The frontend communicates with the Lab34 Flows API through:

- **REST endpoints** for data fetching (`/flows`, `/applications`)
- **Environment-based configuration** using `VITE_API_URL`
- **Proxy configuration** in Vite for seamless development
- **Request/Response interceptors** for logging and error handling

## Styling

Uses MUI Joy's design system with:

- **CSS-in-JS styling** with `sx` prop
- **Responsive design** with Grid system
- **Dark/light theme support** via CssVarsProvider
- **Consistent spacing and typography**
- **Modern component variants** (outlined, soft, solid)

## Development Features

- **Hot Module Replacement (HMR)** for instant updates
- **Fast refresh** preserving component state
- **TypeScript support** (can be enabled)
- **ESLint integration** for code quality
- **Optimized builds** with tree shaking and code splitting
