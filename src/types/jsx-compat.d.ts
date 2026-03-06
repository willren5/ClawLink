import type React from 'react';

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
  }
}

export {};
