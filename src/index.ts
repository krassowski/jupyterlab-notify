import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { LabIcon } from '@jupyterlab/ui-components';
import {
  createDefaultFactory,
  IToolbarWidgetRegistry,
} from '@jupyterlab/apputils';
import { bellOutlineIcon, bellFilledIcon, bellOffIcon, bellAlertIcon } from './icons';


namespace CommandIDs {
  export const toggleCellNotifications = 'toggle-cell-notifications';
}

const CELL_METADATA_KEY = 'jupyterlab_notify.notify';


interface IMode {
  label: string;
  icon: LabIcon;
}

const ModeIds = ['always', 'never', 'on-error', 'global-timeout', 'custom-timeout'] as const;
type ModeId = typeof ModeIds[number];

const MODES: Record<ModeId, IMode> = {
  'always': {
    label: 'Always',
    icon: bellFilledIcon
  },
  'never': {
    label: 'Never',
    icon: bellOffIcon
  },
  'on-error': {
    label: 'On error',
    icon: bellAlertIcon
  },
  'global-timeout': {
    label: 'If longer than global timeout',
    icon: bellOutlineIcon
  },
  'custom-timeout': {
    label: 'If longer than %1',
    icon: bellOutlineIcon // TODO: custom icon with a tiny clock
  }
}


interface ICellMetadata {
  mode: ModeId;
  timeoutSeconds?: number;
}

/**
 * Initialization data for the jupyterlab-notify extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-notify:plugin',
  description: '',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [IToolbarWidgetRegistry, ITranslator, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null,
    settingRegistry: ISettingRegistry | null,
  ) => {
    console.log('JupyterLab extension jupyterlab-notify is activated!');
    // TODO make it customizable
    const defaultMode = 'global-timeout';

    const trans = (translator ?? nullTranslator).load('jupyterlab-notify');
      app.commands.addCommand(CommandIDs.toggleCellNotifications, {
      label: args => {
        const current = tracker.currentWidget;
        return trans._n(
          'Toggle Notifications for Selected Cell',
          'Toggle Notifications for %1 Selected Cells',
          current?.content.selectedCells.length ?? 1,
        );
      },
      execute: args => {
        const current = tracker.currentWidget;
        if (!current) {
          console.warn(
            'Cannot toggle notifications on cells - no notebook selected',
          );
          return;
        }
        for (const cell of current.content.selectedCells) {
          const oldMetadata = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata | undefined;
          const oldModeId = oldMetadata?.mode ?? defaultMode;
          let nextModeIndex = ModeIds.indexOf(oldModeId) + 1;
          if (nextModeIndex >= ModeIds.length) {
            nextModeIndex = 0;
          }
          const newModeId = ModeIds[nextModeIndex];
          cell.model.setMetadata(CELL_METADATA_KEY, {mode: newModeId, ...oldMetadata});
          app.commands.notifyCommandChanged(CommandIDs.toggleCellNotifications);
        }
      },
      icon: args => {
        if (!args.toolbar) {
          return undefined;
        }
        const current = tracker.currentWidget;
        if (!current) {
          return undefined;
        }
        const cell = current.content.selectedCells[0];
        const metadata = cell.model.getMetadata(CELL_METADATA_KEY) as ICellMetadata | undefined;
        const modeId = metadata?.mode ?? defaultMode;
        const mode = MODES[modeId];
        return mode.icon;
      },
      isEnabled: args => (args.toolbar ? true : !!tracker.currentWidget),
    });

    if (toolbarRegistry) {
      // TODO: add a dropdown to select timeout
      const itemFactory = createDefaultFactory(app.commands);
      toolbarRegistry.addFactory('Cell', 'notify', widget => {
        const toolbarButton = itemFactory('Cell', widget, {
          name: 'notify',
          command: CommandIDs.toggleCellNotifications,
        });
        // const dropDownButton = new
        return toolbarButton
      });
    }

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          console.log('jupyterlab-notify settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error('Failed to load settings for jupyterlab-notify.', reason);
        });
    }
  },
};

export default plugin;
