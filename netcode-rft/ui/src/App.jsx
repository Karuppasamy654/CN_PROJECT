import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TransferProvider } from './context/TransferContext';
import NetworkSimulationScreen from './screens/NetworkSimulationScreen';
import EquationLabScreen from './screens/EquationLabScreen';

export default function App() {
  return (
    <TransferProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<NetworkSimulationScreen />} />
          <Route path="/equations" element={<EquationLabScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TransferProvider>
  );
}
