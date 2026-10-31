import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import authReducer from './slices/authSlice';
import groupsReducer from './slices/groupsSlice';
import gatewayReducer from './slices/gatewaySlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    groups: groupsReducer,
    gateway: gatewayReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
