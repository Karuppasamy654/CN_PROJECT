import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TransferProvider } from './context/TransferContext';
import NetworkSimulationScreen from './screens/NetworkSimulationScreen';
import EquationLabScreen from './screens/EquationLabScreen';
import RlncVsRudpComparisonScreen from './screens/RlncVsRudpComparisonScreen';
import NetAnimViewerScreen from './screens/NetAnimViewerScreen';
import NetworkVisualizerScreen from './screens/NetworkVisualizerScreen';
import ExperimentHistoryScreen from './screens/ExperimentHistoryScreen';

export default function App() {
  return (
    <TransferProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<NetworkSimulationScreen />} />
          <Route path="/comparison" element={<RlncVsRudpComparisonScreen />} />
          <Route path="/netanim" element={<NetAnimViewerScreen />} />
          <Route path="/visualizer" element={<NetworkVisualizerScreen />} />
          <Route path="/history" element={<ExperimentHistoryScreen />} />
          <Route path="/equations" element={<EquationLabScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TransferProvider>
  );
}
