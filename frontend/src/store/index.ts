import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import authReducer from './slices/authSlice';
import gatewayReducer from './slices/gatewaySlice';
import projectsReducer from './slices/projectsSlice';
import secretsReducer from './slices/secretsSlice';
import systemReducer from './slices/systemSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    gateway: gatewayReducer,
    projects: projectsReducer,
    secrets: secretsReducer,
    system: systemReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/**
 * The address clients reach this computer's gateway on: its network address
 * when the gateway is open to the network, "localhost" otherwise.
 */
export function useGatewayUrl(): string {
  return useAppSelector(({ system }) => {
    const gateway = system.status?.gateway;
    if (!gateway) return 'http://localhost:8100';

    const address = gateway.public ? system.status?.addresses[0]?.address : undefined;
    return `http://${address ?? 'localhost'}:${gateway.port}`;
  });
}
