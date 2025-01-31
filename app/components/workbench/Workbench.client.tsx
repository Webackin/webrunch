import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import useViewport from '~/lib/hooks';
import Cookies from 'js-cookie';
import { chatId as chatIdStore, db, getMessages, setMessages, updateChatGitHubRepository } from '~/lib/persistence';
import { createCommandsMessage, detectProjectCommands } from '~/utils/projectCommands';
import { generateId } from '~/utils/fileUtils';
import type { Message } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import { webcontainer } from '~/lib/webcontainer';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const chatIdFromStore = useStore(chatIdStore);

  const [isPushing, setIsPushing] = useState(false);

  const [isPulling, setIsPulling] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const isSmallViewport = useViewport(1024);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  const [chatId, setChatId] = useState<string>();

  useEffect(() => {
    setChatId(chatIdFromStore);
  }, [chatIdFromStore]);

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const handleSyncFiles = useCallback(async () => {
    setIsSyncing(true);

    try {
      const directoryHandle = await window.showDirectoryPicker();
      await workbenchStore.syncFiles(directoryHandle);
      toast.success('Files synced successfully');
    } catch (error) {
      console.error('Error syncing files:', error);
      toast.error('Failed to sync files');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const getCredentials = (): { username: string; token: string } | null => {
    const githubUsername = Cookies.get('githubUsername');
    const githubToken = Cookies.get('githubToken');

    if (githubUsername && githubToken) {
      return { username: githubUsername, token: githubToken };
    }

    const username = prompt('Please enter your GitHub username:') || '';
    const token = prompt('Please enter your GitHub personal access token:') || '';

    if (!username || !token) {
      alert('GitHub username and token are required. Push to GitHub cancelled.');
      return null;
    }

    return { username, token };
  };

  const handlePushToGitHub = useCallback(
    async (db: IDBDatabase, id: string) => {
      const getCommitMessage = (): string | null => {
        const commitMessage = prompt('Please enter your commit message:');

        if (!commitMessage) {
          alert('Commit message is required. Push to GitHub cancelled.');
          return null;
        }

        return commitMessage;
      };

      try {
        setIsPushing(true); // Start pushing immediately

        const credentials = getCredentials();

        if (!credentials) {
          return;
        }

        const repoName = await updateChatGitHubRepository(db, id);

        if (!repoName) {
          return;
        }

        const commitMessage = getCommitMessage();

        if (!commitMessage) {
          return;
        }

        await workbenchStore.pushToGitHub(id, commitMessage, credentials.username, credentials.token);

        toast.success('Successfully pushed to GitHub');
      } catch (error) {
        toast.error('Failed to update GitHub repository');

        console.error('Error updating GitHub repository:', error);
      } finally {
        setIsPushing(false); // Stop pushing
      }
    },
    [setIsPushing],
  );

  const handlePullFromGitHub = useCallback(
    async (db: IDBDatabase, id: string) => {
      const getCredentials = (): { username: string; token: string } | null => {
        const githubUsername = Cookies.get('githubUsername');
        const githubToken = Cookies.get('githubToken');

        if (githubUsername && githubToken) {
          return { username: githubUsername, token: githubToken };
        }

        const username = prompt('Please enter your GitHub username:') || '';
        const token = prompt('Please enter your GitHub personal access token:') || '';

        if (!username || !token) {
          alert('GitHub username and token are required. Pull from GitHub cancelled.');
          return null;
        }

        return { username, token };
      };

      function transformFilesResponse(response: FileMap): { path: string; content: string }[] {
        return Object.entries(response)
          .filter(
            ([, value]) =>
              (value as { type: 'file'; content: string })?.type === 'file' &&
              typeof (value as { content: string }).content === 'string',
          )
          .map(([path, value]) => ({
            path,
            content: (value as { content: string }).content,
          }));
      }

      try {
        setIsPulling(true); // Start pulling immediately
        await updateChatGitHubRepository(db, id);

        const credentials = getCredentials();

        if (!credentials) {
          return;
        }

        const { repoFiles } = await workbenchStore.pullFromGitHub(id, credentials.username, credentials.token);

        if (!repoFiles) {
          return;
        }

        const fileContents = transformFilesResponse(repoFiles);

        const commands = await detectProjectCommands(fileContents);
        const commandsMessage = createCommandsMessage(commands);

        const chat = await getMessages(db, id);

        console.log('webcontainer: ', webcontainer);

        const filesMessage: Message = {
          role: 'assistant',
          content: `Pulling the repo ${chat?.gitHubRepo} into
        <boltArtifact id="imported-files" title="Git Pulled Files" type="bundled">
        ${fileContents
          .map(
            (file) =>
              `<boltAction type="file" filePath="${file.path}">
        ${file.content}
        </boltAction>`,
          )
          .join('\n')}
        </boltArtifact>`,
          id: generateId(),
          createdAt: new Date(),
        };

        const messages = [filesMessage];

        if (commandsMessage) {
          messages.push(commandsMessage);
        }

        // Append new messages to existing chat messages
        const updatedMessages = [...chat.messages, ...messages];

        await setMessages(db, id, updatedMessages, chat.urlId, chat.description, chat?.gitHubRepo);

        window.location.reload();

        // await importChat(`Git Project:`, messages);

        toast.success('Successfully pulled from GitHub');
      } catch (error) {
        toast.error('Failed to pull GitHub repository');

        console.error('Error pulling GitHub repository:', error);
      } finally {
        setIsPulling(false); // Stop pulling
      }
    },
    [setIsPulling],
  );

  return (
    chatStarted && (
      <motion.div
        initial="closed"
        animate={showWorkbench ? 'open' : 'closed'}
        variants={workbenchVariants}
        className="z-workbench"
      >
        <div
          className={classNames(
            'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'w-full': isSmallViewport,
              'left-0': showWorkbench && isSmallViewport,
              'left-[var(--workbench-left)]': showWorkbench,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 px-2 lg:px-6">
            <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
              <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                <div className="ml-auto" />
                {selectedView === 'code' && (
                  <div className="flex overflow-y-auto">
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.downloadZip();
                      }}
                    >
                      <div className="i-ph:code" />
                      Download Code
                    </PanelHeaderButton>
                    <PanelHeaderButton className="mr-1 text-sm" onClick={handleSyncFiles} disabled={isSyncing}>
                      {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                      {isSyncing ? 'Syncing...' : 'Sync Files'}
                    </PanelHeaderButton>
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </PanelHeaderButton>

                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      disabled={isPulling}
                      onClick={() => {
                        if (!db) {
                          toast.error('Chat persistence is not available');
                          return;
                        }

                        if (!chatId) {
                          toast.error('Chat Id is not available');
                          return;
                        }

                        // Pull changes from github repository
                        handlePullFromGitHub(db, chatId);
                      }}
                    >
                      {isPulling ? <div className="i-ph:spinner" /> : <div className="i-ph:git-pull-request" />}

                      {isPulling ? 'Pulling...' : 'Pull from GitHub'}
                    </PanelHeaderButton>

                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      disabled={isPushing}
                      onClick={() => {
                        if (!db) {
                          toast.error('Chat persistence is not available');
                          return;
                        }

                        if (!chatId) {
                          toast.error('Chat Id is not available');
                          return;
                        }

                        // Push changes to github repository
                        handlePushToGitHub(db, chatId);
                      }}
                    >
                      {isPushing ? <div className="i-ph:spinner" /> : <div className="i-ph:github-logo" />}

                      {isPushing ? 'Pushing...' : 'Push to GitHub'}
                    </PanelHeaderButton>
                  </div>
                )}
                <IconButton
                  icon="i-ph:x-circle"
                  className="-mr-1"
                  size="xl"
                  onClick={() => {
                    workbenchStore.showWorkbench.set(false);
                  }}
                />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <View
                  initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  animate={{ x: selectedView === 'code' ? 0 : '-100%' }}
                >
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                <View
                  initial={{ x: selectedView === 'preview' ? 0 : '100%' }}
                  animate={{ x: selectedView === 'preview' ? 0 : '100%' }}
                >
                  <Preview />
                </View>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
