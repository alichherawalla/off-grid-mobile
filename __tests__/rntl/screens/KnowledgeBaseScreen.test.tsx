/**
 * KnowledgeBaseScreen — what a user sees and can do in a project's knowledge base.
 *
 * REWRITTEN from a mockist unit test that jest.mock-ed our own `ragBootstrap` module (deleted in
 * 5fc92f88) and our own store. It now mounts the REAL screen over the REAL Mobile composition root and
 * the REAL RAG facade (`applicationFacade().rag`), with fakes only at the device boundary: the SQLite
 * driver, the filesystem, and the native embedding engine. Documents are genuinely indexed through the
 * production `addDocument` seam, so the list, the sizes, the toggle and the delete are the real ones.
 *
 * The add-document GESTURE (picker → index) is covered by the rendered guards in
 * __tests__/integration/knowledge-base/ (kbFileSizeGuard, kbIndexEmbedFailAbort, kbScannedPdfMessage);
 * this file owns the LIST surface those do not assert: names, sizes, open, enable/disable, remove, back.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

let fixture: MobileApplicationFixture | undefined;
let boundary: ReturnType<typeof installNativeBoundary>;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

/** Mount the real screen for project `p1` after indexing `docs` through the production RAG facade. */
async function mountKb(docs: ReadonlyArray<{ fileName: string; bytes: number }>) {
  boundary = installNativeBoundary({ fs: true, llama: true });
  doMockRealSqlite();
  mockNavigate.mockClear();
  mockGoBack.mockClear();

  const RNFS = require('react-native-fs');
  await RNFS.writeFile(`${boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`, 'GGUF');

  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();

  const { useProjectStore } = require('../../../src/stores/projectStore');
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'My Project', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }],
  });

  for (const doc of docs) {
    boundary.fs!.seedFile(`/docs/${doc.fileName}`, doc.bytes);
    const indexed = await fixture.application.rag.addDocument({
      projectId: 'p1',
      path: `/docs/${doc.fileName}`,
      fileName: doc.fileName,
      size: doc.bytes,
    });
    if (!indexed.ok) throw new Error(JSON.stringify(indexed.failure));
  }

  const React = require('react');
  const rtl = requireRTL();
  const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
  const view = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
  return { rtl, view };
}

describe('the knowledge base a user opens for a project', () => {
  it('shows the project it belongs to, and says so when it is empty', async () => {
    const { rtl, view } = await mountKb([]);
    // The title is the user's own proof they are in the right project's KB, not another one's.
    await rtl.waitFor(() => expect(view.queryByText('My Project')).not.toBeNull());
    expect(view.queryByText('No documents yet')).not.toBeNull();
  });

  it('lists each indexed document by name and readable size', async () => {
    const { rtl, view } = await mountKb([
      { fileName: 'readme.txt', bytes: 500 },
      { fileName: 'notes.txt', bytes: 2048 },
    ]);
    await rtl.waitFor(() => expect(view.queryByText('readme.txt')).not.toBeNull());
    expect(view.queryByText('notes.txt')).not.toBeNull();
    // Raw byte counts are unreadable; the user is shown the unit they think in.
    expect(view.queryByText('500 B')).not.toBeNull();
    expect(view.queryByText('2.0 KB')).not.toBeNull();
  });

  it('opens a document when the user taps it', async () => {
    const { rtl, view } = await mountKb([{ fileName: 'readme.txt', bytes: 500 }]);
    await rtl.waitFor(() => expect(view.queryByText('readme.txt')).not.toBeNull());
    rtl.fireEvent.press(view.getByText('readme.txt'));
    expect(mockNavigate).toHaveBeenCalledWith('DocumentPreview', expect.objectContaining({ fileName: 'readme.txt' }));
  });

  it('takes the user back when they press back', async () => {
    const { rtl, view } = await mountKb([]);
    await rtl.waitFor(() => expect(view.queryByText('No documents yet')).not.toBeNull());
    rtl.fireEvent.press(view.getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('turning a document off and removing it', () => {
  it('persists a document being switched off, so retrieval stops using it', async () => {
    const { rtl, view } = await mountKb([{ fileName: 'file.txt', bytes: 100 }]);
    await rtl.waitFor(() => expect(view.queryByText('file.txt')).not.toBeNull());

    const { Switch } = require('react-native');
    rtl.fireEvent(view.UNSAFE_getAllByType(Switch)[0], 'valueChange', false);

    // The switch is not cosmetic: the real DB row must say disabled, or the document is still retrieved
    // while the user believes they excluded it.
    await rtl.waitFor(async () => {
      const listed = await fixture!.application.rag.listDocuments('p1');
      if (!listed.ok) throw new Error('listDocuments failed');
      expect(listed.value[0].enabled).toBeFalsy();
    });
  });

  it('asks before removing a document, and removes it for real on confirm', async () => {
    const { rtl, view } = await mountKb([{ fileName: 'file.txt', bytes: 100 }]);
    await rtl.waitFor(() => expect(view.queryByText('file.txt')).not.toBeNull());

    const { Alert } = require('react-native');
    let confirm: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      confirm = (args[2] as Array<{ style?: string; onPress?: () => void }> | undefined)
        ?.find(b => b.style === 'destructive')?.onPress;
    });

    rtl.fireEvent.press(view.getByLabelText('Remove file.txt'));
    // Deletion is irreversible, so the user is asked first and the file is named in the question.
    expect(Alert.alert).toHaveBeenCalledWith('Remove Document', expect.stringContaining('file.txt'), expect.any(Array));

    await rtl.act(async () => { confirm?.(); });
    await rtl.waitFor(() => expect(view.queryByText('file.txt')).toBeNull());
  });
});
