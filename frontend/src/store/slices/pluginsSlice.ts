import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { fetchPlugins, reloadPlugins } from '@/api/plugins';
import type { PluginsInfo } from '@/types/gateway.types';

// The plugins a work can use: read once, and again when the folder is reloaded.

export interface PluginsState {
  info?: PluginsInfo;
  status: 'idle' | 'loading' | 'ready' | 'failed';
}

export const loadPlugins = createAsyncThunk<PluginsInfo>('plugins/load', () => fetchPlugins());
export const reloadPluginsFolder = createAsyncThunk<PluginsInfo>('plugins/reload', () => reloadPlugins());

const initialState: PluginsState = { status: 'idle' };

const pluginsSlice = createSlice({
  name: 'plugins',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadPlugins.pending, (state) => {
        if (!state.info) state.status = 'loading';
      })
      .addCase(loadPlugins.fulfilled, (state, action) => {
        state.info = action.payload;
        state.status = 'ready';
      })
      .addCase(loadPlugins.rejected, (state) => {
        if (!state.info) state.status = 'failed';
      })
      .addCase(reloadPluginsFolder.fulfilled, (state, action) => {
        state.info = action.payload;
        state.status = 'ready';
      });
  },
});

export default pluginsSlice.reducer;
