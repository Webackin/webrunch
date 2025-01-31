import type { WebContainer } from '@webcontainer/api';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { webcontainer as webcontainerPromise } from '~/lib/webcontainer';
import git, { type GitAuth, type PromiseFsClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import Cookies from 'js-cookie';
import { toast } from 'react-toastify';
import { Octokit } from '@octokit/rest';

const lookupSavedPassword = (url: string) => {
  const domain = url.split('/')[2];
  const gitCreds = Cookies.get(`git:${domain}`);

  if (!gitCreds) {
    return null;
  }

  try {
    const { username, password } = JSON.parse(gitCreds || '{}');
    return { username, password };
  } catch (error) {
    console.log(`Failed to parse Git Cookie ${error}`);
    return null;
  }
};

const saveGitAuth = (url: string, auth: GitAuth) => {
  const domain = url.split('/')[2];
  Cookies.set(`git:${domain}`, JSON.stringify(auth));
};

export function useGit() {
  const [ready, setReady] = useState(false);
  const [webcontainer, setWebcontainer] = useState<WebContainer>();
  const [fs, setFs] = useState<PromiseFsClient>();
  const fileData = useRef<Record<string, { data: any; encoding?: string }>>({});
  useEffect(() => {
    webcontainerPromise.then((container) => {
      fileData.current = {};
      setWebcontainer(container);
      setFs(getFs(container, fileData));
      setReady(true);
    });
  }, []);

  const gitClone = useCallback(
    async (url: string) => {
      if (!webcontainer || !fs || !ready) {
        throw 'Webcontainer not initialized';
      }

      fileData.current = {};

      const headers: {
        [x: string]: string;
      } = {
        'User-Agent': 'bolt.diy',
      };

      const auth = lookupSavedPassword(url);

      if (auth) {
        headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
      }

      try {
        await git.clone({
          fs,
          http,
          dir: webcontainer.workdir,
          url,
          depth: 1,
          singleBranch: true,
          corsProxy: '/api/git-proxy',
          headers,

          onAuth: (url) => {
            let auth = lookupSavedPassword(url);

            if (auth) {
              return auth;
            }

            if (confirm('This repo is password protected. Ready to enter a username & password?')) {
              auth = {
                username: prompt('Enter username'),
                password: prompt('Enter password'),
              };
              return auth;
            } else {
              return { cancel: true };
            }
          },
          onAuthFailure: (url, _auth) => {
            toast.error(`Error Authenticating with ${url.split('/')[2]}`);
          },
          onAuthSuccess: (url, auth) => {
            saveGitAuth(url, auth);
          },
        });

        const data: Record<string, { data: any; encoding?: string }> = {};

        for (const [key, value] of Object.entries(fileData.current)) {
          data[key] = value;
        }

        return { workdir: webcontainer.workdir, data };
      } catch (error) {
        console.error('Git clone error:', error);
        throw error;
      }
    },
    [webcontainer, fs, ready],
  );

  const gitPush = useCallback(
    async (remote: string, branch: string) => {
      if (!webcontainer || !fs || !ready) {
        throw 'Webcontainer not initialized';
      }

      try {
        await git.push({
          fs,
          http,
          dir: webcontainer.workdir,
          remote,
          ref: branch,
          corsProxy: 'https://cors.isomorphic-git.org',
          onAuth: (url) => {
            let auth = lookupSavedPassword(url);

            if (auth) {
              return auth;
            }

            if (confirm('This repo is password protected. Ready to enter a username & password?')) {
              auth = {
                username: prompt('Enter username'),
                password: prompt('Enter password'),
              };
              return auth;
            } else {
              return { cancel: true };
            }
          },
          onAuthFailure: (url, _auth) => {
            toast.error(`Error Authenticating with ${url.split('/')[2]}`);
          },
          onAuthSuccess: (url, auth) => {
            saveGitAuth(url, auth);
          },
        });

        toast.success(`Successfully pushed to ${remote}/${branch}`);
      } catch (error) {
        console.error('Error during git push:', error);
        toast.error('Failed to push changes. Check the console for more details.');
        throw error;
      }
    },
    [webcontainer, fs, ready],
  );

  const gitPull = useCallback(async () => {
    if (!webcontainer || !fs || !ready) {
      throw 'Webcontainer not initialized';
    }

    console.log('Webcontainer: ', webcontainer);

    const headers: { [x: string]: string } = {
      'User-Agent': 'bolt.diy',
    };

    const remoteUrl = await git.getConfig({
      fs,
      dir: webcontainer.workdir,
      path: 'remote.origin.url',
    });

    console.log('remoteUrl: ', remoteUrl);

    if (!remoteUrl) {
      throw 'No remote repository found';
    }

    const auth = lookupSavedPassword(remoteUrl);

    if (auth) {
      headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    }

    try {
      await git.pull({
        fs,
        http,
        dir: webcontainer.workdir,
        singleBranch: true,
        corsProxy: '/api/git-proxy',
        headers,

        onAuth: (url) => {
          let auth = lookupSavedPassword(url);

          if (auth) {
            return auth;
          }

          if (confirm('This repo is password protected. Ready to enter a username & password?')) {
            auth = {
              username: prompt('Enter username'),
              password: prompt('Enter password'),
            };
            return auth;
          } else {
            return { cancel: true };
          }
        },
        onAuthFailure: (url, _auth) => {
          toast.error(`Error Authenticating with ${url.split('/')[2]}`);
        },
        onAuthSuccess: (url, auth) => {
          saveGitAuth(url, auth);
        },
      });

      toast.success('Git pull successful');
    } catch (error) {
      console.error('Git pull error:', error);
      throw error;
    }
  }, [webcontainer, fs, ready]);

  const gitReportIssue = useCallback(
    async (repoName: string, issueTitle: string, githubUsername?: string, ghToken?: string, issueBody?: string) => {
      if (!repoName) {
        throw new Error('Repository name is required.');
      }

      try {
        // Use cookies if username and token are not provided
        let username = githubUsername || Cookies.get('githubUsername');
        let token = ghToken || Cookies.get('githubToken');

        if (!username || !token) {
          username = prompt('Please enter your GitHub username:') || '';
          token = prompt('Please enter your GitHub personal access token:') || '';

          if (!username || !token) {
            alert('GitHub username and token are required. Issue reporting cancelled.');
            return null; // Explicitly return null for consistency
          }
        }

        // Initialize Octokit with the auth token
        const octokit = new Octokit({ auth: token });

        // Create a new issue
        const response = await octokit.issues.create({
          owner: username,
          repo: repoName,
          title: issueTitle,
          body: issueBody || 'No description provided.',
          labels: ['bug'],
        });

        toast.success('Issue reported successfully!');

        return response.data; // Return the created issue data
      } catch (error) {
        console.error('Error reporting to GitHub:', error);
        toast.error('Failed to report issue. Check the console for more details.');

        return null; // Consistently return null when an error occurs
      }
    },
    [],
  );

  return { ready, gitClone, gitPush, gitPull, gitReportIssue };
}

const getFs = (
  webcontainer: WebContainer,
  record: MutableRefObject<Record<string, { data: any; encoding?: string }>>,
) => ({
  promises: {
    readFile: async (path: string, options: any) => {
      const encoding = options?.encoding;
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        const result = await webcontainer.fs.readFile(relativePath, encoding);

        return result;
      } catch (error) {
        throw error;
      }
    },
    writeFile: async (path: string, data: any, options: any) => {
      const encoding = options.encoding;
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      if (record.current) {
        record.current[relativePath] = { data, encoding };
      }

      try {
        const result = await webcontainer.fs.writeFile(relativePath, data, { ...options, encoding });

        return result;
      } catch (error) {
        throw error;
      }
    },
    mkdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        const result = await webcontainer.fs.mkdir(relativePath, { ...options, recursive: true });

        return result;
      } catch (error) {
        throw error;
      }
    },
    readdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        const result = await webcontainer.fs.readdir(relativePath, options);

        return result;
      } catch (error) {
        throw error;
      }
    },
    rm: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        const result = await webcontainer.fs.rm(relativePath, { ...(options || {}) });

        return result;
      } catch (error) {
        throw error;
      }
    },
    rmdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        const result = await webcontainer.fs.rm(relativePath, { recursive: true, ...options });

        return result;
      } catch (error) {
        throw error;
      }
    },
    unlink: async (path: string) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);

      try {
        return await webcontainer.fs.rm(relativePath, { recursive: false });
      } catch (error) {
        throw error;
      }
    },
    stat: async (path: string) => {
      try {
        const relativePath = pathUtils.relative(webcontainer.workdir, path);
        const resp = await webcontainer.fs.readdir(pathUtils.dirname(relativePath), { withFileTypes: true });
        const name = pathUtils.basename(relativePath);
        const fileInfo = resp.find((x) => x.name == name);

        if (!fileInfo) {
          throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
        }

        return {
          isFile: () => fileInfo.isFile(),
          isDirectory: () => fileInfo.isDirectory(),
          isSymbolicLink: () => false,
          size: 1,
          mode: 0o666, // Default permissions
          mtimeMs: Date.now(),
          uid: 1000,
          gid: 1000,
        };
      } catch (error: any) {
        console.log(error?.message);

        const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        err.errno = -2;
        err.syscall = 'stat';
        err.path = path;
        throw err;
      }
    },
    lstat: async (path: string) => {
      return await getFs(webcontainer, record).promises.stat(path);
    },
    readlink: async (path: string) => {
      throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
    },
    symlink: async (target: string, path: string) => {
      /*
       * Since WebContainer doesn't support symlinks,
       * we'll throw a "operation not supported" error
       */
      throw new Error(`EPERM: operation not permitted, symlink '${target}' -> '${path}'`);
    },

    chmod: async (_path: string, _mode: number) => {
      /*
       * WebContainer doesn't support changing permissions,
       * but we can pretend it succeeded for compatibility
       */
      return await Promise.resolve();
    },
  },
});

const pathUtils = {
  dirname: (path: string) => {
    // Handle empty or just filename cases
    if (!path || !path.includes('/')) {
      return '.';
    }

    // Remove trailing slashes
    path = path.replace(/\/+$/, '');

    // Get directory part
    return path.split('/').slice(0, -1).join('/') || '/';
  },

  basename: (path: string, ext?: string) => {
    // Remove trailing slashes
    path = path.replace(/\/+$/, '');

    // Get the last part of the path
    const base = path.split('/').pop() || '';

    // If extension is provided, remove it from the result
    if (ext && base.endsWith(ext)) {
      return base.slice(0, -ext.length);
    }

    return base;
  },
  relative: (from: string, to: string): string => {
    // Handle empty inputs
    if (!from || !to) {
      return '.';
    }

    // Normalize paths by removing trailing slashes and splitting
    const normalizePathParts = (p: string) => p.replace(/\/+$/, '').split('/').filter(Boolean);

    const fromParts = normalizePathParts(from);
    const toParts = normalizePathParts(to);

    // Find common parts at the start of both paths
    let commonLength = 0;
    const minLength = Math.min(fromParts.length, toParts.length);

    for (let i = 0; i < minLength; i++) {
      if (fromParts[i] !== toParts[i]) {
        break;
      }

      commonLength++;
    }

    // Calculate the number of "../" needed
    const upCount = fromParts.length - commonLength;

    // Get the remaining path parts we need to append
    const remainingPath = toParts.slice(commonLength);

    // Construct the relative path
    const relativeParts = [...Array(upCount).fill('..'), ...remainingPath];

    // Handle empty result case
    return relativeParts.length === 0 ? '.' : relativeParts.join('/');
  },
};
