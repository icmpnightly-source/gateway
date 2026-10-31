import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import authReducer from './slices/authSlice';
import gatewayReducer from './slices/gatewaySlice';
import projectsReducer from './slices/projectsSlice';
import secretsReducer from './slices/secretsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    gateway: gatewayReducer,
    projects: projectsReducer,
    secrets: secretsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
