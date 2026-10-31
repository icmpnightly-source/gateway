import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { engineErrorMessage } from '@/api/engine';
import { createProject, deleteProject, fetchProjects, updateProject } from '@/api/projects';
import type { Project, ProjectsState, TokenField } from '@/types/gateway.types';

// Projects live in the shared database next to the rules they group: every change is written
// there and the list is read back.

// Rejections carry the engine's message ('' when it gave none).
type ThunkConfig = { rejectValue: string };

export const loadProjects = createAsyncThunk<Project[], void, ThunkConfig>(
  'projects/load',
  async (_, { rejectWithValue }) => {
    try {
      return await fetchProjects();
    } catch (error) {
      return rejectWithValue(engineErrorMessage(error));
    }
  },
);

/** Resolves with the new project, so the caller can go straight to it. */
export const addProject = createAsyncThunk<Project, string, ThunkConfig>(
  'projects/add',
  async (name, { dispatch, rejectWithValue }) => {
    try {
      const project = await createProject(name);
      await dispatch(loadProjects());
      return project;
    } catch (error) {
      return rejectWithValue(engineErrorMessage(error));
    }
  },
);

interface ChangeProjectArgs {
  id: string;
  name?: string;
  tokenFields?: TokenField[];
}

export const changeProject = createAsyncThunk<void, ChangeProjectArgs, ThunkConfig>(
  'projects/change',
  async ({ id, ...changes }, { dispatch, rejectWithValue }) => {
    try {
      await updateProject(id, changes);
    } catch (error) {
      return rejectWithValue(engineErrorMessage(error));
    }
    await dispatch(loadProjects());
  },
);

export const removeProject = createAsyncThunk<void, string, ThunkConfig>(
  'projects/remove',
  async (id, { dispatch, rejectWithValue }) => {
    try {
      await deleteProject(id);
    } catch (error) {
      return rejectWithValue(engineErrorMessage(error));
    }
    await dispatch(loadProjects());
  },
);

const initialState: ProjectsState = { items: [], status: 'idle' };

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadProjects.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadProjects.fulfilled, (state, action) => {
        state.status = 'ready';
        state.items = action.payload;
      })
      .addCase(loadProjects.rejected, (state) => {
        state.status = 'failed';
      });
  },
});

export default projectsSlice.reducer;
