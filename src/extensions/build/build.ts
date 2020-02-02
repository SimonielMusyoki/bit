import { Paper } from '../paper';
import { RunCmd } from './build.cmd';
import { Workspace } from '../workspace';
import { Capsule } from '../../capsule';
import { Component } from '../component';
import { TaskContext } from './task-context';
import { ResolvedComponent } from '../workspace/resolved-component';

export type BuildDeps = [Paper, Workspace, Capsule];

export type Options = {
  parallelism: number;
};

export type TaskFn = (context: TaskContext) => void;

export class Build {
  private tasks = {};

  constructor(
    /**
     * Bit's workspace
     */
    private workspace: Workspace,

    private capsule: Capsule
  ) {}

  async getComponentsForBuild(components?: string[]) {
    if (components) return this.workspace.getMany(components);
    const modified = await this.workspace.modified();
    const newComps = await this.workspace.newComponents();
    return modified.concat(newComps);
  }

  registerTask(name: string, taskFn: TaskFn) {
    this.tasks[name] = taskFn;
  }

  getConfig(component: ResolvedComponent) {
    if (component.component.config.extensions.run) {
      return component.component.config.extensions.run;
    }

    return {};
  }

  async run(pipeline: string, components?: Component[], options?: Options) {
    const componentsToBuild = components || (await this.getComponentsForBuild(components));
    // check if config is sufficent before building capsules and resolving deps.
    const resolvedComponents = await this.workspace.load(componentsToBuild.map(comp => comp.id.toString()));
    // add parrlalism and execute by graph order (use gilad's graph builder once we have it)
    const promises = resolvedComponents.map(async component => {
      const capsule = component.capsule;
      const pipe = this.getConfig(component)[pipeline];
      if (!Array.isArray(pipe))
        console.log(`skipping component ${component.component.id.toString()}, it has no defined '${pipeline}'`);
      console.log(`building component ${component.component.id.toString()}...`);

      pipe.forEach(async (elm: string) => {
        if (this.tasks[elm]) return this.runTask(elm, new TaskContext(component));
        // should execute registered extension tasks as well
        const exec = await capsule.exec({ command: elm.split(' ') });
        exec.stdout.on('data', chunk => console.log(chunk.toString()));

        const promise = new Promise(resolve => {
          exec.stdout.on('close', () => resolve());
        });

        // save dists? add new dependencies? change component main file? add further configs?
        await promise;
      });
    });

    return Promise.all(promises).then(() => resolvedComponents);
  }

  private runCommand() {}

  private async runTask(name: string, context: TaskContext) {
    // we need to set task as dev dependency, install and run. stdout, stderr return.
    // use the old compiler api to make everything work.
    return this.tasks[name](context);
  }

  static async provide(config: {}, [paper, workspace, capsule]: BuildDeps) {
    const build = new Build(workspace, capsule);
    // @ts-ignore
    paper.register(new RunCmd(build));
    return build;
  }
}
