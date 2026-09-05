# Even/Odd Market Ranker - Deriv

A real-time trading analysis tool that ranks Deriv Volatility Index markets by tradability for Even/Odd digit contracts.

## Features

- **Real-time Market Analysis**: Tracks 10 volatility markets simultaneously
- **Dual Mode**: 
  - Demo mode with simulated data (works anywhere)
  - Live mode with real Deriv WebSocket feed
- **Smart Scoring**: Evaluates markets based on:
  - Rolling bias (even/odd distribution)
  - Statistical deviation (z-score)
  - Streak behavior
  - Bias stability

## Getting Started

### Prerequisites
- Node.js 14+
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
```

## Using Live Mode

1. Register an app at [api.deriv.com/dashboard](https://api.deriv.com/dashboard)
2. Get your `app_id`
3. Paste it into the "Live" mode input field
4. The app will connect to Deriv's WebSocket and start streaming real market data

## API Details

- **WebSocket URL**: `wss://ws.deriv.com/websockets/v3`
- **Markets**: Volatility Index markets (R_10, R_25, R_50, R_75, R_100, 1HZ variants)
- **Data**: Real-time tick data with last digit extraction
- **No Authentication Required**: Public market data calls don't need OAuth

## Markets Tracked

- Volatility 10 (R_10)
- Volatility 25 (R_25)
- Volatility 50 (R_50)
- Volatility 75 (R_75)
- Volatility 100 (R_100)
- 1-Second variants of each above

## Scoring Metrics

- **Even %**: Percentage of even-digit closes
- **Z-Score**: Statistical deviation from 50/50 expectation
- **Streak**: Current run of same parity digits
- **Stability**: Consistency of bias across rolling window halves
- **Tradability**: Composite score for trading viability

## Architecture

- Built with React 18
- Vite for fast development and builds
- Pure CSS-in-JS (no external styling dependencies)
- Single shared WebSocket connection for all markets

## License

MIT
